goog.provide("firefly.Graph");

goog.require('goog.debug.Logger');


firefly.Graph = function(container, sourcerer, makeURL, serialized, height) {
	this.logger_ = goog.debug.Logger.getLogger('firefly.Graph');

	this.makeURL_ = makeURL;

	this.sourcerer = sourcerer;
	this.container = container;
	this._options = undefined;
	this._title = undefined;
	this._sources = [];

	// we reserve the right to instantiate a Graph without a DOM container.
	if (container) {
		this.height = height;
		$(container).data('ff:graph', this);
		this.sync(serialized || {});
	}
};

/**
 * @type {goog.debug.Logger}
 * @protected
 */
firefly.Graph.prototype.logger_ = null;


firefly.Graph.prototype.DEFAULT_ZOOM = "3600";


/** produce a simple js object representation of this graph */
firefly.Graph.prototype.serialize = function() {
	var obj = {};
	obj.sources = this.getSources();
	if (this._title) {
		obj.title = this._title;
	}
	obj.zoom = this.zoom;
	if (this._options) {
		obj.options = this._options;
	}
	return obj;
};


/** sync this graph to the serialized representation passed in */
firefly.Graph.prototype.sync = function(serialized) {
	this.setSources([]);
	$(this._container).empty();
	this._domInited = false;
	this._graphEl = this._legendEl = this._titleEl = null;

	this.zoom = serialized.zoom || this.DEFAULT_ZOOM;
	this._title = serialized.title || undefined;
	this._options = serialized.options || undefined;
	if (serialized.sources) {
		this.setSources(serialized.sources);
	} else {
		this.setDOMAsEmpty();
	}
};

/** sync this graph's options to the serialized representation passed in */
firefly.Graph.prototype.syncOptions = function(serialized) {
	this._options = serialized;
	this.updateGraph();
};


firefly.Graph.prototype.clear = function() {
	this.sync({});
};

/** get the list of sources for this graph */
firefly.Graph.prototype.getSources = function() {return this._sources;};

/** helper fxn - is the sources list empty? */
firefly.Graph.prototype.isEmpty = function() {
	return this.renderer === null;
};

/** set the list of sources for this graph (ie/ bulk add/remove) */
firefly.Graph.prototype.setSources = function(sources) {
	var oldSources = this._sources;
	// do a deep-ish copy of the sources so we don't get all wonky
	this._sources = $.map(sources, function(src) {return [src.slice(0)];});
	this.sourcesChanged(oldSources);
};

/** add the key to the graph at the given index */
firefly.Graph.prototype.addSource = function(key, idx) {
	var oldSources = this._sources.slice(0);
	this._sources.splice(idx, 0, key);
	this.sourcesChanged(oldSources);
};

/** remove the key at the given index */
firefly.Graph.prototype.removeSource = function(idx) {
	var oldSources = this._sources.slice(0);
	this._sources.splice(idx, 1);
	this.sourcesChanged(oldSources);
};

firefly.Graph.prototype.setOptions = function(opts) {
	this._options = opts;
	this.sourcesChanged(this._sources);
};

/**
 * worker fxn called whenever the sources for a graph have changed.
 * - updates the renderer associated with the graph
 * - updates the stuff in the container if we're transitioning states
 * - causes the graph to be re-rendered
 * - causes the legend to be updated
 */
firefly.Graph.prototype.sourcesChanged = function(oldSources) {
	// if we delayed rendering of the graph (due to loading a saved set in the dash),
	// we'll still want to do the appropriate drawing
	if (this._sources.length && (!oldSources.length || !this._domInited)) {
		// sort of ugly LoD violation - shouldn't have to go this far for this info
		this.setDOMAsPopulated();
		// if we're adding sources to an empty graph, make sure our renderer is set up
		this.renderer = this.getRenderer();
		this.updateGraph();
		this.updateTitle();
	} else if ((oldSources.length || !this._domInited) && !this._sources.length) {
		if (this.renderer) {
			this.renderer.cleanup();
			this.renderer = null;
		}
		this.setDOMAsEmpty();
	} else if (oldSources.length && this._sources.length) {
		this.updateGraph();
		this.updateTitle();
	}
};

firefly.Graph.prototype.getRenderer = function() {
	return new firefly.Renderer(
		this,
		this.makeURL_,
		this._graphEl,
		this._titleEl,
		this._legendEl,
		this.height);
};

firefly.Graph.prototype.setZoom = function(zoomLevel) {
	if (zoomLevel != this.zoom) {
		this.zoom = zoomLevel;
		this.updateGraph();
	}
};

firefly.Graph.prototype.setHeight = function(height) {
	this.height = height;
	if (this.renderer) {
		this.renderer.setContainerHeight_(height);
	}
	// this.height = height;
	// this.renderer
	this.resizeGraph();
};

/** set up the cell when transitioning to empty state */
firefly.Graph.prototype.setDOMAsEmpty = function() {
	var frag = document.createDocumentFragment();

	var addSourcesLink = document.createElement('a');
	$(addSourcesLink).text("add sources");
	$(addSourcesLink).attr({'rel': 'action-edit-sources', 'href': '#'});
	frag.appendChild(addSourcesLink);

	frag.appendChild(document.createElement('hr'));

	var listDashboardsLink = document.createElement('a');
	$(listDashboardsLink).text("list dashboards");
	$(listDashboardsLink).attr({'href': this.makeURL_("dashboards")});
	frag.appendChild(listDashboardsLink);

	this._legendEl = this._titleEl = this._graphEl = null;

	$(this.container).empty();
	$(this.container).addClass('empty');
	this.container.appendChild(frag);

	if (!this._domInited) {
		this._domInited = true;
	}
};

/** set up the container for when transitioning to populated state */
firefly.Graph.prototype.setDOMAsPopulated = function() {
	var graphContainer = document.createElement('div');
	graphContainer.className = "graph-content-container";

	// title stuff
	var container = document.createElement('div');
	container.className = "graph-title-container";
	var titleLabel = document.createElement('h2');
	titleLabel.innerHTML = "Graph Title:";
	titleLabel.className = "graph-title-label";
	container.appendChild(titleLabel);
	var title = document.createElement('h3');
	title.className = "graph-title";
	this._titleEl = title;
	var that = this;
	$(title).inplace({
		'onSave': function(newTitle) {
			that.setTitle(newTitle);
		}
	});
	container.appendChild(title);
	graphContainer.appendChild(container);

	// stuff for the actual graph region
	var container = document.createElement('div');
	container.className = "graph-region-container";
	var graphDivLabel = document.createElement('h2');
	graphDivLabel.innerHTML = "Graph:";
	graphDivLabel.className = "graph-label";
	container.appendChild(graphDivLabel);
	var div = document.createElement('div');
	div.className = "actual-graph";
	this._graphEl = div;
	container.appendChild(div);
	graphContainer.appendChild(container);

	// legend region
	var container = document.createElement('div');
	container.className = "graph-legend-container";
	var legendLabel = document.createElement('h2');
	legendLabel.innerHTML = "Graph Legend:";
	container.appendChild(legendLabel);
	var legendDiv = document.createElement('div');
	legendDiv.className = 'legend clearfix';
	this._legendEl = legendDiv;
	container.appendChild(legendDiv);
	graphContainer.appendChild(container);

	// finish it up
	$(this.container).empty();
	$(this.container).removeClass('empty');
	this.container.appendChild(graphContainer);

	if (!this._domInited) {
		this._domInited = true;
	}
};

firefly.Graph.prototype.setTitle = function(title) {
	this._title = title;
	if (title === undefined) {
		this.updateTitle();
	}
};

firefly.Graph.prototype.updateTitle = function() {
	if (!this._title) {
		if (this.renderer) this.renderer.title(this.getSources());
	} else {
		$(this._titleEl).empty();
		this._titleEl.innerText = this._title;
	}
};

firefly.Graph.prototype.updateLegend = function() {
	if (this.renderer) this.renderer.legend(this.getSources());
};

firefly.Graph.prototype.updateGraph = function() {
	if (this.renderer) this.renderer.render(this.zoom, this._options);
};

firefly.Graph.prototype.resizeGraph = function() {
	if (this.renderer) {
		this.renderer.resize();
		this.renderer.render(this.zoom, this._options);
	}
};
