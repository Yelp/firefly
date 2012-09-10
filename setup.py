from distutils.core import setup

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
    install_requires=[
        "tornado >= 1.1, <2.0",
        "pyyaml >= 3.09",
        "python-rrdtool >= 1.4.7",
        "simplejson",
        "pycurl"
    ]
)
