# -*- mode: ruby -*-
# vi: set ft=ruby :

VAGRANTFILE_API_VERSION = "2"

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box = "saucy"
  config.vm.box_url = "http://puppet-vagrant-boxes.puppetlabs.com/ubuntu-1310-x64-virtualbox-puppet.box"

  config.vm.network :forwarded_port, guest: 8890, host: 8890   # Firefly data server
  config.vm.network :forwarded_port, guest: 8889, host: 8889   # Firefly UI server
  config.ssh.forward_agent = true

  config.vm.provider :virtualbox do |vb|
    vb.customize ["modifyvm", :id, "--memory", "1024"]
  end

  config.vm.provision :puppet do |puppet|
    puppet.module_path    = "Vagrant/modules"
    puppet.manifests_path = "Vagrant/manifests"
    puppet.manifest_file  = "init.pp"
  end

end
