targetScope = 'resourceGroup'

@minLength(3)
@maxLength(20)
@description('Lowercase alphanumeric prefix for this environment; no production resource names are embedded.')
param namePrefix string

@description('Azure region for registry and monitoring resources.')
param location string = resourceGroup().location

@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param acrSku string = 'Premium'

var suffix = uniqueString(subscription().id, resourceGroup().id, namePrefix)
var acrName = take(toLower(replace('${namePrefix}${suffix}', '-', '')), 50)
var workspaceName = take('${namePrefix}-logs-${suffix}', 63)
var insightsName = take('${namePrefix}-ai-${suffix}', 260)

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: workspaceName
  location: location
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  sku: {
    name: 'PerGB2018'
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: acrSku
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output appInsightsResourceId string = insights.id
