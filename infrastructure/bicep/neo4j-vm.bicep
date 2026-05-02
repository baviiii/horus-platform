@description('Location for all resources')
param location string = 'australiaeast'

@description('Environment name')
param environment string = 'dev'

@description('Admin username for the VM')
param adminUsername string = 'azureuser'

@description('Admin password for the VM')
@secure()
param adminPassword string

@description('VM size')
param vmSize string = 'Standard_D2s_v3'

@description('Neo4j version')
param neo4jVersion string = '5.15.0'

var vmName = 'neo4j-vm-${environment}'
var nicName = '${vmName}-nic'
var nsgName = '${vmName}-nsg'
var publicIPName = '${vmName}-pip'
var vnetName = 'careercraft-vnet-${environment}'
var subnetName = 'neo4j-subnet'
var osDiskName = '${vmName}-osdisk'
var dataDiskName = '${vmName}-datadisk'

// Network Security Group
resource nsg 'Microsoft.Network/networkSecurityGroups@2023-05-01' = {
  name: nsgName
  location: location
  properties: {
    securityRules: [
      {
        name: 'Allow-Neo4j-Browser'
        properties: {
          priority: 1000
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '7474'
        }
      }
      {
        name: 'Allow-Neo4j-Bolt'
        properties: {
          priority: 1001
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '7687'
        }
      }
      {
        name: 'Allow-SSH'
        properties: {
          priority: 1002
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
    ]
  }
}

// Virtual Network
resource vnet 'Microsoft.Network/virtualNetworks@2023-05-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.0.0.0/16'
      ]
    }
    subnets: [
      {
        name: subnetName
        properties: {
          addressPrefix: '10.0.1.0/24'
          networkSecurityGroup: {
            id: nsg.id
          }
        }
      }
    ]
  }
}

// Public IP
resource publicIP 'Microsoft.Network/publicIPAddresses@2023-05-01' = {
  name: publicIPName
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      domainNameLabel: 'careercraft-neo4j-${environment}-${uniqueString(resourceGroup().id)}'
    }
  }
}

// Network Interface
resource nic 'Microsoft.Network/networkInterfaces@2023-05-01' = {
  name: nicName
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: {
            id: vnet.properties.subnets[0].id
          }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: {
            id: publicIP.id
          }
        }
      }
    ]
  }
}

// Virtual Machine
resource vm 'Microsoft.Compute/virtualMachines@2023-03-01' = {
  name: vmName
  location: location
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      adminPassword: adminPassword
      linuxConfiguration: {
        disablePasswordAuthentication: false
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        name: osDiskName
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Premium_LRS'
        }
        diskSizeGB: 128
      }
      dataDisks: [
        {
          name: dataDiskName
          diskSizeGB: 256
          lun: 0
          createOption: 'Empty'
          managedDisk: {
            storageAccountType: 'Premium_LRS'
          }
        }
      ]
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
  }
}

// VM Extension to install Neo4j
resource vmExtension 'Microsoft.Compute/virtualMachines/extensions@2023-03-01' = {
  parent: vm
  name: 'installNeo4j'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Extensions'
    type: 'CustomScript'
    typeHandlerVersion: '2.1'
    autoUpgradeMinorVersion: true
    settings: {
      skipDos2Unix: false
    }
    protectedSettings: {
      commandToExecute: '''
        #!/bin/bash
        set -e
        
        # Update system
        apt-get update
        apt-get upgrade -y
        
        # Install Java 17
        apt-get install -y openjdk-17-jdk
        
        # Format and mount data disk
        mkfs.ext4 /dev/sdc
        mkdir -p /var/lib/neo4j
        mount /dev/sdc /var/lib/neo4j
        echo "/dev/sdc /var/lib/neo4j ext4 defaults 0 0" >> /etc/fstab
        
        # Add Neo4j repository
        wget -O - https://debian.neo4j.com/neotechnology.gpg.key | apt-key add -
        echo 'deb https://debian.neo4j.com stable latest' > /etc/apt/sources.list.d/neo4j.list
        apt-get update
        
        # Install Neo4j Community (free)
        apt-get install -y neo4j=1:5.15.0
        
        # Configure Neo4j
        NEO4J_CONF=/etc/neo4j/neo4j.conf
        
        # Set initial password
        neo4j-admin dbms set-initial-password 'ChangeMe123!'
        
        # Configure for remote access
        sed -i 's/#server.default_listen_address=0.0.0.0/server.default_listen_address=0.0.0.0/' $NEO4J_CONF
        
        # Enable APOC and Graph Data Science
        echo "server.directories.plugins=/var/lib/neo4j/plugins" >> $NEO4J_CONF
        echo "dbms.security.procedures.unrestricted=apoc.*,gds.*" >> $NEO4J_CONF
        echo "dbms.security.procedures.allowlist=apoc.*,gds.*" >> $NEO4J_CONF
        
        # Memory settings for 8GB RAM
        echo "server.memory.heap.initial_size=2g" >> $NEO4J_CONF
        echo "server.memory.heap.max_size=2g" >> $NEO4J_CONF
        echo "server.memory.pagecache.size=3g" >> $NEO4J_CONF
        
        # Download APOC and GDS plugins
        cd /var/lib/neo4j/plugins
        wget https://github.com/neo4j/apoc/releases/download/5.15.0/apoc-5.15.0-core.jar
        wget https://graphdatascience.ninja/neo4j-graph-data-science-2.5.3.jar
        
        # Set ownership
        chown -R neo4j:neo4j /var/lib/neo4j
        
        # Enable and start Neo4j
        systemctl enable neo4j
        systemctl start neo4j
        
        # Wait for Neo4j to start
        sleep 30
        
        echo "Neo4j installation complete!"
      '''
    }
  }
}

output vmName string = vm.name
output publicIP string = publicIP.properties.ipAddress
output fqdn string = publicIP.properties.dnsSettings.fqdn
output neo4jBrowserUrl string = 'http://${publicIP.properties.dnsSettings.fqdn}:7474'
output neo4jBoltUrl string = 'bolt://${publicIP.properties.dnsSettings.fqdn}:7687'
output sshCommand string = 'ssh ${adminUsername}@${publicIP.properties.ipAddress}'
