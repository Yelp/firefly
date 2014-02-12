class firefly::service {
  file { '/etc/init.d/firefly':
    owner => root,
    group => root,
    mode   => '0755',
    source => "puppet:///modules/firefly/firefly.init",
  } ->
  service { 'firefly':
    ensure     => running,
    enable     => true,
    hasrestart => true,
    hasstatus  => false,
    require    => [ File['/etc/firefly/firefly.yaml'] ],
  }
}
