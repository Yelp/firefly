class firefly::testdata {

  file { '/var/lib/firefly':
    ensure => directory,
    owner  => root,
    group  => root,
    mode   => '0755',
  }

  file { '/tmp/test-whisper-data.sh':
    ensure  => directory,
    owner   => root,
    group   => root,
    mode    => '0755',
    source  => "puppet:///modules/firefly/test-whisper-data.sh",
    require => File['/var/lib/firefly'],
  }

  exec { 'whisper-create':
    command => "/usr/bin/start-stop-daemon --start -x /tmp/test-whisper-data.sh",
    require => File['/tmp/test-whisper-data.sh']
  }

}
