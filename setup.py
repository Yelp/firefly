import os
import platform
from setuptools import find_packages
from setuptools import setup

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

setup(
    name='firefly',
    version='1.1.1',
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
