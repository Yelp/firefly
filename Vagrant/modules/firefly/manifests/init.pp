class firefly {
  class { 'firefly::packages': } ->
  class { 'firefly::config': } ->
  class { 'firefly::testdata': } ->
  class { 'firefly::service': }
}
