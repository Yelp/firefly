import os
import platform
from setuptools import setup

requirements = [
    "pycurl",
    "pyyaml >= 3.09",
    "tornado >= 1.1, <2.0",
]

# python-rrdtool doesn't install cleanly out of the box on OS X
if not (os.name == "posix" and platform.system() == "Darwin"):
    requirements.append("python-rrdtool >= 1.4.7")

setup(
    name='firefly',
    version='1.0',
    provides=['firefly'],
    author='Yelp',
    description='A multi-datacenter graphing tool',
    packages=['firefly'],
    long_description="""Firefly provides graphing of performance metrics from multiple data centers and sources.
    Firefly works with both the Ganglia and Statmonster data sources.
    """,
    install_requires=requirements
)
