goog.provide("firefly.Sourcerer");

goog.require('goog.debug.Logger');


/**
 * @constructor
 */
firefly.Sourcerer = function(dataServers, makeURL) {
	this.logger_ = goog.debug.Logger.getLogger('firefly.Sourcerer');

	this.makeURL_ = makeURL;

	this._sources = {'children': [], 'desc': "IT'S THE ROOT MOFO"};
	var that = this;
	$.each(dataServers, function(idx, ds) {
		that._sources.children.push({
			'name': ds.name,
			'type': 'server',
			'desc': ds.desc,
			'children': null
		});
	});
};


/**
 * @type {goog.debug.Logger}
 * @protected
 */
firefly.Sourcerer.prototype.logger_ = null;


/** @type {number} */
firefly.Sourcerer.prototype.TOKEN_REFRESH_INTERVAL_ = 30000; // 30 seconds

firefly.Sourcerer.prototype.last_token_time_ = 0;

firefly.Sourcerer.prototype.last_token_ = "";

firefly.Sourcerer.prototype.getToken = function() {
	var sourcerer = this;
	var now = Date.now();
	if (now - this.last_token_time_ >= this.TOKEN_REFRESH_INTERVAL_) {
		$.ajax({
			url: this.makeURL_('token'),
			async: false,
			dataType: 'text',
			context: this,
			success: function(data) {
				sourcerer.last_token_ = data;
			}
		});
		this.last_token_time_ = now;
	}
	return this.last_token_;
};


/**
 * synchronously fetch the list of nodes at a given root and return it
 */
firefly.Sourcerer.prototype.fetchPath = function(path) {
	this.logger_.finer('fetchPath', path);
	var entries = [];
	$.ajax({
		url: path[0] + '/sources',
		async: false,
		dataType: 'json',
		data: {
			'path': JSON.stringify(path.slice(1)),
			'token': this.getToken()},
		context: this,
		success: function(data) {
			entries = data;
		}
	});
	return entries;
};


/**
 * get the node specified by @path from the internal representation of the source tree.
 */
firefly.Sourcerer.prototype.getGraphRoot = function(path) {
	this.logger_.finer("getGraphRoot", path);

	var obj = this._sources.children;
	for (var i=0; i<path.length; i++) {
		var componentName = path[i];
		var childNode = this._findNamedComponentInList(obj, componentName);

		// always optimistically load the list of child nodes
		if ((childNode.type !== 'file') && (childNode.children === null)) {
			var children = this.fetchPath(path.slice(0,i+1));
			childNode.children = children;
		}

		if (i === (path.length - 1)) {
			// if we're at the end of the path, break - the outer
			// loop is done anyway so we'll hit the return at the
			// end of the function
			obj = childNode;
			break;
		} else {
			if (childNode.type === 'file') {
				// if this is a file but the path hasn't been consumed,
				// it's an invalid path
				throw "InvalidPath:ComponentIsFile: " + path;
			} else {
				// otherwise we should go into the children list of
				// this component and continue along
				obj = childNode.children;
			}
		}
	}
	return obj;
};


firefly.Sourcerer.prototype._findNamedComponentInList = function(list, name) {
	for (var i=0; i<list.length; i++) {
		var component = list[i];
		if (component.name === name) {
			return component;
		}
	}

	throw "InvalidPath:ComponentNotFound: '" + name + "' not in " + list;
};


/**
  * given some arbitrary path, return the node representing the associated Data Source
  */
firefly.Sourcerer.prototype.getDataSourceNode = function(path) {
	// any source is like [data_server, data_source, path...]
	// so we want the second node in the list for the data_source info
	if (path.length < 2) {
		throw "InvalidPath:NoDataSourceFound: '"+ path + "'";
	}
	return this.getGraphRoot(path.slice(0, 2));
};


/**
  * given some arbitrary path, return the node representing the associated Data Server
  */
firefly.Sourcerer.prototype.getDataServerNode = function(path) {
	// any source is like [data_server, data_source, path...]
	// so we want the first node in the list for the data_server info
	if (path.length < 1) {
		throw "InvalidPath:NoDataSourceFound: '"+ path + "'";
	}
	return this.getGraphRoot([path[0]]);
};
