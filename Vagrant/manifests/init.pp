exec { "apt-update":
  command => "/usr/bin/apt-get update"
}

class { 'firefly':
  require => Exec['apt-update'],
}
