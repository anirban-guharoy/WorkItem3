using '../main.bicep'

param environmentName = 'dev'
param baseName = 'mtagent'
// Dev only: public network access and the Standard Service Bus SKU (no private endpoints) keep costs low.
param serviceBusSku = 'Standard'
param publicNetworkAccess = true
param aksNodeCount = 1
param aksAdminGroupObjectIds = [] // add Entra group object ids
// Provide at deploy time: -p postgresAdminPassword=$(secure source)
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
