class firefly::testdata {

  file { '/var/lib/firefly':
    ensure => directory,
    owner  => root,
    group  => root,
    mode   => '0755',
  } ->
  file { '/usr/local/bin/fake-whisper-update.sh':
    ensure  => directory,
    owner   => root,
    group   => root,
    mode    => '0755',
    source  => "puppet:///modules/firefly/fake-whisper-update.sh",
  } ->
  file { '/etc/init.d/fake-whisper-update':
    owner => root,
    group => root,
    mode   => '0755',
    source => "puppet:///modules/firefly/fake-whisper-update.init",
  } ->
  service { 'fake-whisper-update':
    ensure     => running,
    enable     => true,
    hasrestart => false,
    hasstatus  => false,
  }

}
