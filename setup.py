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
    requires=[
        "tornado (>=1.1)",
        "pyyaml (>=3.09)",
        "rrdtool (>=1.4.7)"
    ]
)
