goog.provide("firefly.GraphEdit");

goog.require('goog.debug.Logger');


/**
 * @constructor
 */
firefly.GraphEdit = function(sourceGraph, sources, makeURL, options) {
	this.logger_ = goog.debug.Logger.getLogger('firefly.GraphEdit');
	this.makeURL_ = makeURL;
	this.sourceGraph = sourceGraph;
	var serializedSource = this.sourceGraph.serialize();

	this.sources = sources;
	this.options = options || {};

	this._container = this.createDOM(serializedSource.options || {});
	this.observeEvents();
	$(this._container).css('display', 'none');
	document.body.appendChild(this._container);

	$(this._container).overlay({
		mask: {
			color: '#ccc',
			loadSpeed: 200,
			opacity: 0.5
		},

		top: 'center',
		left: 'center',

		// we'll handle closing the dialog ourselves
		closeOnClick: false,
		closeOnEsc: false,

		// load it immediately after the construction
		load: true
	});

	// TODO(bigo): wtf does this 40px come frome
	var availHeight = $(this._container).height() - $(this._container).find('.pane > h2').height() - 40;
	$(this._container).find('.pane > div').css({'height': availHeight + 'px'});

	this.graph = new firefly.Graph(this._actualGraphEl, sources, this.makeURL_, serializedSource, availHeight-150);

	var selectedSources = this.sourceGraph.getSources();
	if (selectedSources.length > 0) {
		for (var i=0; i<selectedSources.length; i++) {
			this.addSourceSelector(selectedSources[i]);
		}
	} else {
		this.addSourceSelector();
	}
};

/**
 * @type {goog.debug.Logger}
 * @protected
 */
firefly.GraphEdit.prototype.logger_ = null;


/**
 * observe events on children of the edit pane
 */
firefly.GraphEdit.prototype.observeEvents = function() {
	var that = this;

	$(document).bind("keydown", function(evt) {
		// listen for the esc key, close without saving
		if (evt.which == 27) that.close(false);
	});

	$(this._container).delegate('[rel=cancel-edits]', 'click', function(evt) {
		// close without saving the graph
		that.close(false);
	});

	$(this._container).delegate('[rel=save-edits]', 'click', function(evt) {
		// close and save the graph
		that.close(true);
	});

	$(this._container).delegate('[rel=dir] span', 'click', function(evt) {
		var target = $(evt.target).parent().get(0);
		if ($(target).attr('rel') == 'dir') {
			if ($(target).hasClass('open')) {
				that.closeGraphDir(target);
			} else {
				that.openGraphDir(target);
			}
		}
	});

	/** add-source and remove-source are called to add or remove from the graph **/
	$(this._container).delegate(".source-selector", "ff:add-source", function(evt, key) {
		var idx = $(".source-selector").filter(function() {
			return $(this).data('ff:selected-source');
		}).index(this);
		that.graph.addSource(key, idx);
	});
	$(this._container).delegate(".source-selector", "ff:remove-source", function(evt, key) {
		var idx = $(".source-selector").filter(function() {
			return $(this).data('ff:selected-source');
		}).index(this);
		that.graph.removeSource(idx);
	});

	/** events for managing the source selectors themselves **/
	$(this._container).delegate('[rel=add-source-selector-below]', 'click', function(evt) {
		var next = $(this).closest('.source-selector').next('.source-selector');
		that.addSourceSelector(null, next.length ? next.get(0) : null);
	});
	$(this._container).delegate('[rel=clone-source-selector-below]', 'click', function(evt) {
		var ss = $(this).closest('.source-selector').get(0);
		var next = $(ss).next('.source-selector');
		var currentSrc = $(ss).data('ff:selected-source');
		var newss = that.addSourceSelector(currentSrc, next.length ? next.get(0) : null);
		currentSrc && $(newss).trigger('ff:add-source', [currentSrc]);
	});
	$(this._container).delegate('[rel=remove-source-selector]', 'click', function(evt) {
		that.addSourceSelector(null, $(this).closest('.source-selector').get(0));
	});
};

/**
 * close the entire edit pane
 */
firefly.GraphEdit.prototype.close = function(save) {
	$(this._container).data('overlay').close();
	$(this._container).remove();
	$(document).unbind("keydown");

	if (save) {
		this.options.onSave(this.graph.serialize());
	} else {
		this.options.onExit();
	}
};

firefly.GraphEdit._domTemplate = $([
	"<div class='graphedit'>",
		"<div class='pane data-sources'>",
			"<h2>Data Sources <small>(only <b>one</b> datacenter supported per graph)</small></h2>",
			"<div></div>",
		"</div>",
		"<div class='pane temp-graph'>",
			"<h2>Preview</h2>",
			"<div class='graph'></div>",
		"</div>",
		"<div class='pane controls'>",
			"<h2>Controls</h2>",
			"<div></div>",
		"</div>",
		"<div class='footer'>",
			"<button class='pseudo-link' rel='cancel-edits'>Cancel</button>",
			"<button class='pseudo-link' rel='save-edits'>Save & Close</button>",
		"</div>",
	"</div>"].join('')).get(0);

/**
 * create the DOM for a top-level source list
 */
firefly.GraphEdit.prototype.createDOM = function(graphOptions) {
	var div = $(firefly.GraphEdit._domTemplate).clone().get(0);

	// source selection region
	this._dataSourceDiv = $(div).find('.data-sources').children('div').get(0);
	$(this._dataSourceDiv).sortable({axis: 'y', containment: 'parent', tolerance: 'pointer',
		update: function(evt, ui) {
			if ($(ui.item).data('ff:selected-source')) {
				var sources = [];
				$(".source-selector").each(function() {
					var selectedSource = $(this).data('ff:selected-source');
					if (selectedSource) sources.push(selectedSource);
				});
				that.graph.setSources(sources);
			}
		}
	});

	// used by the graph for rendering itself
	this._actualGraphEl = $(div).find('.temp-graph').find('.graph').get(0);

	// set up controls
	var controlDiv = $(div).find('.controls').children('div').get(0);
	$(controlDiv).append(this.getControls(graphOptions));
	var that = this;

	// watch for changes to the options inputs.
	// onchange, re-serialize the complete set of options and put it back to the graph object
	$(controlDiv).delegate('input', 'change', function() {
		// TODO: maybe invert this to walk this.controls rather than infer from the DOM
		var optInputs = $(controlDiv).find('input');
		var optObj = {};
		$.each(optInputs, function() {
			var serialized = $(this).serializeArray()[0];
			// an unchecked checkbox won't serialize, so skip them
			if (serialized) {
				var parsedValue = that.valueParsers[$(this).data('valueType')].call(that, serialized.value);
				optObj[serialized.name] = parsedValue;
			}
		});
		that.graph.setOptions(optObj);
	});

	return div;
};

/**
 * functions for parsing input values into graph option values.
 */
firefly.GraphEdit.prototype.valueParsers = {
	'boolean': function(value) {
		return value && value !== '0';
	},
	'integer': function(value) {
		var parsed = parseInt(value, 10);
		return isNaN(parsed) ? undefined : parsed;
	},
	'float': function(value) {
		var parsed = parseFloat(value);
		return isNaN(parsed) ? undefined : parsed;
	},
	'string': function(value) {
		return value;
	}
};

firefly.GraphEdit.prototype.controls = [
	{'label': "Graph Options", 'groups': [
		{'name': 'y_axis_log_scale', 'inputType': 'checkbox', 'valueType': 'boolean', 'items': [
			{'value': '1', 'label': 'Log-Scale Y Axis'}
		]},
		{'name': 'overlay_previous_period', 'inputType': 'radio', 'valueType': 'integer', 'items': [
			{'value': undefined, 'label': 'Historical Overlay: None'},
			{'value': 1, 'label': 'Historical Overlay: Previous Period'},
			{'value': 60 * 60 * 24, 'label': 'Historical Overlay: -1 Day'},
			{'value': 60 * 60 * 24 * 7, 'label': 'Historical Overlay: -1 Week'}
		]},
		{'name': 'stacked_graph', 'inputType': 'checkbox', 'valueType': 'boolean', 'items': [
			{'value': '1', 'label': 'Stacked Graph'}
		]},
		{'name': 'area_graph', 'inputType': 'checkbox', 'valueType': 'boolean', 'items': [
			{'value': '1', 'label': 'Area Graph'}
		]},
		{'name': 'show_annotations', 'inputType': 'checkbox', 'valueType': 'boolean', 'items': [
			{'value': '1', 'label': 'Show Annotations'},
		]},
		{'name': 'short_annotations', 'inputType': 'checkbox', 'valueType': 'boolean', 'items': [
			{'value': '1', 'label': 'Short Annotations'},
		]},
		{'name': 'y_axis_clamp', 'inputType': 'number', 'valueType': 'float', 'items': [
			{'value': undefined, 'label': 'Y Axis Clamp'},
		]},
		{'name': 'smooth', 'inputType': 'checkbox', 'valueType': 'boolean', 'items': [
			{'value': '1', 'label': 'Smoothing'},
		]},
		{'name': 'smooth_alpha', 'inputType': 'range', 'valueType': 'float', 'items': [
			{'value': 200, 'min': 100, 'max': 400, 'label': 'Smoothing Amount'},
		]}
	]}
];

firefly.GraphEdit.prototype.getControls = function(graphOptions) {
	var frag = $('<div>');
	$.each(this.controls, function(i, section) {
		$('<h3>').text(section.label).appendTo(frag);
		$.each(section.groups, function(j, group) {
			var groupDiv = $('<div>').appendTo(frag);
			$.each(group.items, function(k, item) {
				var itemDiv = $('<div>').appendTo(groupDiv);
				itemDiv.addClass('control');
				var label = $('<label>').appendTo(itemDiv);
				var input = $('<input>').attr({'type': group.inputType, 'name': group.name, 'value': item.value}).appendTo(label);
				input.data('valueType', group.valueType);
				$('<span>').text(item.label).appendTo(label);

				// set input state based on current options and the input type
				if (group.inputType == 'checkbox') {

					// allow for mutually exclusive options
					group.excludes && input.change( function(evt) {
						input.prop('checked') && $.each(group.excludes, function () {
							var other = frag.find('input[name="' + this + '"]');
							if (other.prop('checked')) {
								evt.stopPropagation();
								input.prop('checked', false);
								alert(input.next().text() + " cannot be used with " + other.next().text());
								return false;
							}
						});
					});

					if (graphOptions[group.name] == '1') {
						input.prop('checked', true);
					}
				} else if (group.inputType == 'radio') {
					if (graphOptions[group.name] == item.value) {
						input.prop('checked', true);
					}
				} else if (group.inputType == 'number') {
					input.prop('value', graphOptions[group.name])
				} else if (group.inputType == 'range') {
					input.attr({'value': graphOptions[group.name]});
				}
			});
		});
	});

	return frag;
};

firefly.GraphEdit.prototype.getNodeName = function(path) {
	return path[path.length-1];
};

firefly.GraphEdit.prototype.addSourceSelector = function(selectedSource, beforeEl) {
	var ss = new firefly.SourceSelector(this.sources, selectedSource);
	if (beforeEl) {
		$(beforeEl).before(ss.container);
	} else {
		this._dataSourceDiv.appendChild(ss.container);
	}
	$(ss.container).children('select').chosen();
	return ss.container;
};
