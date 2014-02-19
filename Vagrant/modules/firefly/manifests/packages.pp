class firefly::packages {
  package { 'python-pip':
    ensure => installed,
  }

  package { 'libcurl3-dev':
    ensure => installed,
  }

  package { 'python-dev':
    ensure => installed,
  }

  package { 'python-rrdtool':
    ensure => installed,
  }

  package { 'whisper':
    ensure   => installed,
    provider => pip,
  }

  package { 'tornado':
    ensure   => 2.0,
    provider => pip,
    require  => Package['python-pip'],
  }

  package { 'pycurl':
    ensure   => installed,
    provider => pip,
    require  => [ Package['python-pip'], Package['libcurl3-dev'], Package['python-dev'] ],
  }

  package { 'pyyaml':
    ensure   => 3.10,
    provider => pip,
    require  => Package['python-pip'],
  }

  package { 'testify':
    ensure   => installed,
    provider => pip,
    require  => Package['python-pip'],
  }

  package { 'PyHamcrest':
    ensure   => 1.8,
    provider => pip,
    require  => Package['python-pip'],
  }
}
