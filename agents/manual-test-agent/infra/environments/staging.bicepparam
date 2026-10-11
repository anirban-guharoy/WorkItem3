using '../main.bicep'

param environmentName = 'stg'
param baseName = 'mtagent'
param serviceBusSku = 'Premium'
param publicNetworkAccess = false
param aksNodeCount = 3
param aksAdminGroupObjectIds = [] // add Entra group object ids
param foundryAccountResourceId = '' // resource id of the Azure AI Foundry account hosting the Claude deployment
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
