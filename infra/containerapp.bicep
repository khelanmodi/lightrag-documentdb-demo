@description('Name of the Container Apps environment.')
param environmentName string = 'lightrag-demo-env'

@description('Name of the container app.')
param appName string = 'lightrag-demo-backend'

@description('Azure region.')
param location string = resourceGroup().location

@description('Container image (e.g. ghcr.io/OWNER/REPO/backend:TAG).')
param image string

@description('OpenAI API key.')
@secure()
param openaiApiKey string

@description('DocumentDB connection URI.')
@secure()
param documentdbUri string

@description('Database name.')
param dbName string = 'lightrag_demo'

@description('OpenAI chat model.')
param llmModel string = 'gpt-4o-mini'

@description('OpenAI embedding model.')
param embedModel string = 'text-embedding-3-small'

@description('Optional GHCR username for private image pulls (leave blank for public images).')
param registryUsername string = ''

@description('Optional GHCR PAT/password for private image pulls.')
@secure()
param registryPassword string = ''

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${environmentName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

var hasRegistryAuth = !empty(registryUsername) && !empty(registryPassword)

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        corsPolicy: {
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'POST', 'OPTIONS']
          allowedHeaders: ['*']
        }
      }
      secrets: concat(
        [
          { name: 'openai-api-key', value: openaiApiKey }
          { name: 'documentdb-uri', value: documentdbUri }
        ],
        hasRegistryAuth ? [
          { name: 'registry-password', value: registryPassword }
        ] : []
      )
      registries: hasRegistryAuth ? [
        {
          server: split(image, '/')[0]
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: image
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: [
            { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
            { name: 'DOCUMENTDB_URI', secretRef: 'documentdb-uri' }
            { name: 'DB_NAME', value: dbName }
            { name: 'LLM_MODEL', value: llmModel }
            { name: 'EMBED_MODEL', value: embedModel }
            { name: 'EMBED_DIM', value: '1536' }
            { name: 'LLM_TIMEOUT', value: '120' }
            { name: 'LIGHTRAG_WORKING_DIR', value: '/tmp/lightrag_storage' }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
