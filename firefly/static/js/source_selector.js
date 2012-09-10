goog.provide("firefly.SourceSelector");

goog.require('goog.debug.Logger');


/**
 * @constructor
 */
firefly.SourceSelector = function(sources, initial) {
	this.logger_ = goog.debug.Logger.getLogger('firefly.SourceSelector');

	this._sources = sources;
	this._create(initial);
	this._observeEvents();
};

/**
 * @type {goog.debug.Logger}
 * @protected
 */
firefly.SourceSelector.prototype.logger_ = null;


firefly.SourceSelector.prototype._create = function(initial) {
	var container = document.createElement('div');
	$(container).data('ff:source-selector', this);
	container.className = "source-selector";
	this.container = container;

	// var sources = this._sources.getSources();
	var select = this._createSelect(this._sources.getGraphRoot([]));
	$(select).attr('data-placeholder', 'Select a Source');

	if (initial) {
		for (var i=0; i<initial.length; i++) {
			var subSelect = $(this.container).children('select').last().get(0);
			this._setSelectedValue(subSelect, initial[i]);
		}
	}

	var controls = document.createElement('footer');

	$.each([
		{'rel': 'remove-source-selector', 'html': "remove &empty;"},
		{'rel': 'clone-source-selector-below', 'html': "clone &darr;"},
		{'rel': 'add-source-selector-below', 'html': "new &darr;"},
		], function(idx) {
			var button = document.createElement('button');
			button.className = "pseudo-link";
			$(button).attr({'rel': this.rel});
			button.innerHTML = this.html;
			controls.appendChild(button);
		});
	container.appendChild(controls);
};

firefly.SourceSelector.prototype._createSubSelect = function(node) {
	var select = this._createSelect(node.children);
	$(this.container).inDOM() && $(select).chosen({'disable_search_threshold': 2});
	return select;
};

firefly.SourceSelector.prototype._createSelect = function(entries) {
	var select = document.createElement('select');
	$(select).attr('data-placeholder', ' ');
	var option = document.createElement('option');
	option.value = '';
	select.appendChild(option);
	for (var i=0; i < entries.length; i++) {
		var src = entries[i];
		var option = document.createElement('option');
		option.appendChild(document.createTextNode(src.desc || src.name));
		option.value = src.name;
		select.appendChild(option);
	}

	var footer = $(this.container).find('footer');
	if (footer.length) {
		$(footer).before(select);
	} else {
		this.container.appendChild(select);
	}
	this._setSelectedValue(select, '');
	return select;
};

firefly.SourceSelector.prototype._setSelectedValue = function(select, value) {
	var that = this;
	$(select).children('option').each(function(idx) {
		if (this.value === value) {
			this.selected = true;
			$(select).trigger("liszt:updated");
			that._selectionChanged(select);
			return false;
		}
	});
};

firefly.SourceSelector.prototype._observeEvents = function() {
	var that = this;
	$(this.container).delegate('select', 'change', function(evt) { that._selectionChanged(this); });
	$(this.container).delegate('[rel=remove-source-selector]', 'click', function(evt) { that._removeSourceSelector(); });
};

/**
 * get current selected path by inspecting the SELECTs,
 * leaving off a trailing empty select
 */
firefly.SourceSelector.prototype.getSelectedPath = function() {
	var path = $(this.container).find('select').map(function() {return this.value}).toArray();
	if (!path[path.length - 1]) {
		path = path.slice(0, path.length - 1)
	}
	return path;
};

firefly.SourceSelector.prototype._selectionChanged = function(select) {
	$(select).data('ff:selected-value', select.value);

	// get the full, currently selected path and decide whether
	// it's legit (swapping a SELECT in the middle of the stack)
	// can produce invalid paths
	var selectedPath = this.getSelectedPath();
	var selectedPathIsValid = true;
	try {
		var leafNode = this._sources.getGraphRoot(selectedPath);
	} catch(err) {
		selectedPathIsValid = false;
	}

	if (!selectedPathIsValid) {
		// presumably, the path is valid up to the selection point,
		// so clear out everything after it, and then act appropriately
		// on the newly selected path
		$(select).nextAll('select').unchosen().remove();
		var selectedPath = this.getSelectedPath();
		leafVal = select.value;
		var leafNode = this._sources.getGraphRoot(selectedPath);
	} else {
		// the newly selected path is valid, so we just need to fix up the leaf
		// first delete a trailing blank if there is one
		var lastSelect = $(this.container).find('select').last().get(0);
		if ((lastSelect !== select) && (lastSelect.value === '')) {
			$(lastSelect).unchosen().remove();
			select = $(this.container).find('select').last().get(0);
		} else {
			select = lastSelect;
		}
		var leafVal = select.value;
	}

	this._clearCurrentSrc();

	if (leafVal && (leafNode.type !== 'file')) {
		// if we just selected a sourcelist or dir, show its children
		this._createSubSelect(leafNode);
		var nextSelect = $(select).nextAll('select').get(0);
		// if it only has one real child, recurse as appropriate, auto-selecting
		if (leafNode.children.length == 1) {
			$(nextSelect).children('option').get(1).selected = true;
			$(nextSelect).trigger('liszt:updated');
			this._selectionChanged(nextSelect);
		} else {
			$(nextSelect).focus();
		}
	} else if (leafVal) {
		// if we just selected a file, select it
		$(this.container).data('ff:selected-source', selectedPath);
		$(this.container).trigger('ff:add-source', [selectedPath]);
	} else {
		// we selected the null option, and there's nothing to be done.
	}
};

firefly.SourceSelector.prototype._clearCurrentSrc = function() {
	var currentSrc = $(this.container).data('ff:selected-source');
	if (currentSrc) {
		$(this.container).trigger('ff:remove-source', [currentSrc]);
		$(this.container).data('ff:selected-source', null);
	}
};

firefly.SourceSelector.prototype._removeSourceSelector = function() {
	this._clearCurrentSrc();
	$(this.container).remove();
	this.container = null;
};
