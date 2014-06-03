import os
import platform
from setuptools import find_packages
from setuptools import setup
import subprocess
import sys

requirements = [
    "pycurl",
    "pyyaml == 3.10",
    "tornado >= 1.1, <2.0",
    "testify == 0.5.2",
    "PyHamcrest == 1.8",
]


# python-rrdtool doesn't install cleanly out of the box on OS X
# TODO: python-rrdtool not compiling cleanly on lucid either -- fix later
#if not (os.name == "posix" and platform.system() == "Darwin"):
#    requirements.append("python-rrdtool >= 1.4.7")

# If you know a better way to get the submodules pulled down to the filesystem
# before 'setup.py sdist' gets called, I'm all ears. This is necessary so that
# the static assets in the submodules are included in the distribution
# when built by Jenkins.
if 'sdist' in sys.argv or 'bdist_wheel' in sys.argv:
    try:
        subprocess.check_call(['make', 'production'])
    except subprocess.CalledProcessError, cpe:
        sys.stderr.write("Attempt to 'make production' failed with exit code %s" % cpe.returncode)
        sys.exit(1)

setup(
    name='firefly',
    version='1.1.6',
    provides=['firefly'],
    author='Yelp',
    description='A multi-datacenter graphing tool',
    packages=find_packages(exclude=['tests']),
    long_description="""Firefly provides graphing of performance metrics from multiple data centers and sources.
    Firefly works with both the Ganglia and Statmonster data sources.
    """,
    install_requires=requirements,
    include_package_data=True  # See MANIFEST.in
)
