class firefly::config {

  file { '/etc/firefly':
    ensure => directory,
    owner  => root,
    group  => root,
    mode   => '0755',
  }

  file { '/etc/firefly/firefly.yaml':
    ensure  => file,
    owner   => root,
    group   => root,
    mode    => '0644',
    source  => "puppet:///modules/firefly/firefly.yaml",
    require => File['/etc/firefly'],
  }

  file { '/etc/firefly/logging.conf':
    ensure  => file,
    owner   => root,
    group   => root,
    mode    => '0644',
    source  => "puppet:///modules/firefly/logging.conf",
    require => File['/etc/firefly'],
  }

}
