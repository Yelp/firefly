import logging

class DataSource(object):
    """Base class for Firefly Data Sources"""

    DESC = "Base class for Firefly Data Sources"

    def __init__(self, *args, **kwargs):
        self.logger = logging.getLogger(__name__)

    def list_path(self, path):
        """given an array of path components, list the (presumable) directory"""
        raise NotImplemented

    def graph(self):
        raise NotImplemented

    def data(self):
        raise NotImplemented

    def legend(self):
        raise NotImplemented

    def title(self):
        raise NotImplemented
