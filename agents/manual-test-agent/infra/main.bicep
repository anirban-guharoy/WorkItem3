// Azure infrastructure for the JIRA test case generation agent (agent cluster only).
// The existing MCP server cluster is NOT touched. Deploy with:
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/environments/<env>.bicepparam
// This template has been written against documented resource schemas but has not been deployed from this repository.
targetScope = 'resourceGroup'

@description('Short environment name used in resource names, e.g. dev, stg, prd.')
@minLength(2)
@maxLength(5)
param environmentName string

@description('Base name for resources (lowercase letters/digits).')
@minLength(3)
@maxLength(12)
param baseName string

param location string = resourceGroup().location

@description('Kubernetes namespace and Helm release name used by the chart (service accounts are named <release>-mta-<component>).')
param kubernetesNamespace string = 'manual-test-agent'
param helmReleaseName string = 'mta'

@description('Entra object IDs (users/groups) granted AKS cluster admin.')
param aksAdminGroupObjectIds array = []

@description('PostgreSQL administrator login.')
param postgresAdminLogin string = 'agentadmin'
@secure()
@description('PostgreSQL administrator password. Supply at deploy time from a secure source; it is stored only in Key Vault.')
param postgresAdminPassword string

@description('Optional resource ID of the Azure AI Foundry (Cognitive Services) account; when set the worker identity receives the Cognitive Services User role on it.')
param foundryAccountResourceId string = ''

@description('Service Bus SKU. Premium is required for private endpoints.')
@allowed(['Standard', 'Premium'])
param serviceBusSku string = 'Premium'

@description('Allow public network access to PaaS resources. Keep false in staging/production and use private endpoints.')
param publicNetworkAccess bool = false

param aksNodeVmSize string = 'Standard_D4s_v5'
param aksNodeCount int = 3
param tags object = {}

var suffix = '${baseName}-${environmentName}'
var compactSuffix = toLower('${baseName}${environmentName}')
var allTags = union(tags, { workload: 'manual-test-agent', environment: environmentName })

// Built-in role definition IDs.
var roles = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  keyVaultSecretsUser: '4633458b-17de-409c-9bbb-f1bb2d3ec2d8'
  serviceBusDataSender: '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
  serviceBusDataReceiver: '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'
  cognitiveServicesUser: 'a97b65f3-24c7-4388-baec-2e87135dc908'
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${suffix}'
  location: location
  tags: allTags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${suffix}'
  location: location
  kind: 'web'
  tags: allTags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableLocalAuth: false
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: 'acr${compactSuffix}'
  location: location
  tags: allTags
  sku: { name: 'Premium' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
    anonymousPullEnabled: false
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${compactSuffix}'
  location: location
  tags: allTags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
    networkAcls: { defaultAction: publicNetworkAccess ? 'Allow' : 'Deny', bypass: 'AzureServices' }
  }
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: 'sb-${suffix}'
  location: location
  tags: allTags
  sku: { name: serviceBusSku, tier: serviceBusSku, capacity: serviceBusSku == 'Premium' ? 1 : null }
  properties: {
    disableLocalAuth: true // Entra/Workload Identity only; no SAS keys
    minimumTlsVersion: '1.2'
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
  }
}

resource jobsQueue 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = {
  parent: serviceBus
  name: 'generation-jobs'
  properties: {
    lockDuration: 'PT5M'
    maxDeliveryCount: 5
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT1H'
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P1D'
    enableBatchedOperations: true
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-${suffix}'
  location: location
  tags: allTags
  sku: { name: 'Standard_D2ds_v5', tier: 'GeneralPurpose' }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 64 }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: environmentName == 'prd' ? 'ZoneRedundant' : 'Disabled' }
    network: { publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'manual_test_agent'
}

// The URL is stored only in Key Vault and delivered to pods by the Secrets Store CSI driver.
resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'agent-database-url'
  properties: {
    value: 'postgres://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/${database.name}'
  }
}

resource aks 'Microsoft.ContainerService/managedClusters@2024-09-01' = {
  name: 'aks-${suffix}'
  location: location
  tags: allTags
  identity: { type: 'SystemAssigned' }
  sku: { name: 'Base', tier: environmentName == 'prd' ? 'Standard' : 'Free' }
  properties: {
    dnsPrefix: 'aks-${suffix}'
    enableRBAC: true
    disableLocalAccounts: true
    aadProfile: {
      managed: true
      enableAzureRBAC: true
      adminGroupObjectIDs: aksAdminGroupObjectIds
    }
    oidcIssuerProfile: { enabled: true }
    securityProfile: { workloadIdentity: { enabled: true } }
    networkProfile: {
      networkPlugin: 'azure'
      networkPluginMode: 'overlay'
      networkPolicy: 'cilium'
      networkDataplane: 'cilium'
      outboundType: 'loadBalancer'
    }
    agentPoolProfiles: [
      {
        name: 'system'
        mode: 'System'
        count: aksNodeCount
        vmSize: aksNodeVmSize
        osType: 'Linux'
        availabilityZones: ['1', '2', '3']
        enableAutoScaling: true
        minCount: aksNodeCount
        maxCount: aksNodeCount * 3
      }
    ]
    addonProfiles: {
      azureKeyvaultSecretsProvider: {
        enabled: true
        config: { enableSecretRotation: 'true' }
      }
      omsagent: {
        enabled: true
        config: { logAnalyticsWorkspaceResourceID: logs.id }
      }
    }
    workloadAutoScalerProfile: { keda: { enabled: true } }
    ingressProfile: { webAppRouting: { enabled: true } }
  }
}

// Kubelet pulls images from ACR.
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, aks.id, roles.acrPull)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: aks.properties.identityProfile.kubeletidentity.objectId
    principalType: 'ServicePrincipal'
  }
}

// One user-assigned identity per component (least privilege, separate audit trail).
var components = ['api', 'worker', 'migrate']

resource identities 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = [
  for c in components: {
    name: 'id-${suffix}-${c}'
    location: location
    tags: allTags
  }
]

resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = [
  for (c, i) in components: {
    parent: identities[i]
    name: 'aks-${c}'
    properties: {
      issuer: aks.properties.oidcIssuerProfile.issuerURL
      subject: 'system:serviceaccount:${kubernetesNamespace}:${helmReleaseName}-mta-${c}'
      audiences: ['api://AzureADTokenExchange']
    }
  }
]

// KEDA operator authenticates to Service Bus (queue-depth scaling) as the worker identity.
resource kedaFederation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: identities[1]
  name: 'aks-keda-operator'
  dependsOn: [federation]
  properties: {
    issuer: aks.properties.oidcIssuerProfile.issuerURL
    subject: 'system:serviceaccount:kube-system:keda-operator'
    audiences: ['api://AzureADTokenExchange']
  }
}

resource kvAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (c, i) in components: {
    scope: keyVault
    name: guid(keyVault.id, identities[i].id, roles.keyVaultSecretsUser)
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
      principalId: identities[i].properties.principalId
      principalType: 'ServicePrincipal'
    }
  }
]

// API only sends; worker receives and sends (recovery sweeper and retries re-enqueue).
resource apiSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: jobsQueue
  name: guid(jobsQueue.id, identities[0].id, roles.serviceBusDataSender)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.serviceBusDataSender)
    principalId: identities[0].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: jobsQueue
  name: guid(jobsQueue.id, identities[1].id, roles.serviceBusDataSender)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.serviceBusDataSender)
    principalId: identities[1].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: jobsQueue
  name: guid(jobsQueue.id, identities[1].id, roles.serviceBusDataReceiver)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.serviceBusDataReceiver)
    principalId: identities[1].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (!empty(foundryAccountResourceId)) {
  name: last(split(foundryAccountResourceId, '/'))
}

resource workerModelAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(foundryAccountResourceId)) {
  scope: foundryAccount
  name: guid(foundryAccountResourceId, identities[1].id, roles.cognitiveServicesUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.cognitiveServicesUser)
    principalId: identities[1].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output acrLoginServer string = acr.properties.loginServer
output aksName string = aks.name
output keyVaultName string = keyVault.name
output serviceBusNamespaceFqdn string = '${serviceBus.name}.servicebus.windows.net'
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output apiIdentityClientId string = identities[0].properties.clientId
output workerIdentityClientId string = identities[1].properties.clientId
output migrateIdentityClientId string = identities[2].properties.clientId
