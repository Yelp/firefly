import hashlib
import hmac
import logging
import re
import time
from sys import modules

last_dot_splitter_re = re.compile("((.*)\.)?([^\.]+)")

def last_dot_splitter(dotted_path):
    """Split a string on the last dot.

    'aaa.bbb.ccc' => ('aaa.bbb', 'ccc')
    'aaa' => ('', 'aaa')
    """
    matches = last_dot_splitter_re.findall(dotted_path)
    return matches[0][1], matches[0][2]

def import_module_class(dotted_path):
    """Import a module + class path like 'a.b.c.d' => d attribute of c module"""
    module_name, class_name = last_dot_splitter(dotted_path)

    mod = import_module(module_name)
    try:
        attr = getattr(mod, class_name)
    except AttributeError:
        raise AttributeError("Module %r has no class %r" % (mod, class_name))
    return attr

def import_module(dotted_path):
    """Import a module path like 'a.b.c' => c module"""
    mod = __import__(dotted_path, globals(), locals(), [])
    for name in dotted_path.split('.')[1:]:
        try:
            mod = getattr(mod, name)
        except AttributeError:
            raise AttributeError("Module %r has no attribute %r" % (mod, name))
    return mod

def setup_logging(logger_name):
    """Sets up logging to stdout for a service script."""
    log = logging.getLogger(logger_name)
    log.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    log.addHandler(handler)
    return log

def verify_access_token(token, key):
    """Verify that the given access token is still valid. Returns true if it is,
    false if it either failed to validate or has expired.

    A token is a combination of a unix timestamp and a signature"""
    t = token[:15]
    signature = token[15:]
    expected_signature = hmac.new(key, msg=t, digestmod=hashlib.sha1).hexdigest()
    return signature == expected_signature and int(t) >= int(time.time())

def generate_access_token(key, duration=60):
    """Generate an access token valid for the given number of seconds"""
    t = '%015d' % int(time.time() + duration)
    signature = hmac.new(key, msg=t, digestmod=hashlib.sha1).hexdigest()
    return t + signature

def generate_ds_key(ds):
    return hashlib.sha1(ds).hexdigest()[:6]

# Base58 is the encoding used by bit.ly, flickr, etc. to identify short URLs
# It's Base62 [a-zA-Z0-9] minus chars that can be confused when transcribed by hand
b58chars = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
b58base = len(b58chars)

def b58encode(value):
    """Encodes an integer value as a base58 string"""

    encoded = ""
    while value >= b58base:
        div, mod = divmod(value, b58base)
        encoded = b58chars[mod] + encoded
        value = div
    encoded = b58chars[value] + encoded
    return encoded

def b58decode(encoded):
    """Decodes a base58 string to its integer value"""

    value = 0
    multiplier = 1
    for c in encoded[::-1]:
        value += b58chars.index(c) * multiplier
        multiplier *= b58base
    return value
