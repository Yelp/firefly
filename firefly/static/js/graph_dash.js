goog.provide('firefly.Dashboard');
goog.provide('firefly.DashboardView');

goog.require('goog.debug.Logger');


/**
 * @constructor
 */
firefly.Dashboard = function(data_servers, makeURL, container, isEmbedded) {
	// TODO this is all temp stuff, just trying to get it ported from old constructor
	this.logger_ = goog.debug.Logger.getLogger('firefly.Dashboard');
	this.embedded_ = isEmbedded;
	this.makeURL_ = makeURL;

	this.sources = new firefly.Sourcerer(data_servers, makeURL);

	this.view = new firefly.DashboardView(this, container);

	this.view.render();
	this.observeEvents();
	this.unpauseUpdates_();

};

/** ms between graph updates */
firefly.Dashboard.prototype.REGULAR_REFRESH_INTERVAL = 10000;

/** min-height of graph in px */
firefly.Dashboard.prototype.MINIMUM_GRAPH_HEIGHT = 200;




/**
 * @type {goog.debug.Logger}
 * @protected
 */
firefly.Dashboard.prototype.logger_ = null;

firefly.Dashboard.prototype.hashchange_mutex_ = false;

firefly.Dashboard.prototype.graphs_ = [];

/**
 * debug helper to print an internal representation of the dashboard
 */
firefly.Dashboard.prototype.printGraphs_ = function() {
	this.logger_.info("dashboard dimensions are " + this.columnCount + " x " + this.graphs_.length);
	for (var i=0; i<this.graphs_.length; i++) {
		var row = "|";
		for (var j=0; j<this.graphs_[i].length; j++) {
			row += this.graphs_[i][j]._id;
			row += "|";
		}
		this.logger_.info(row);
	}
};


/**
 * add a graph to the internal matrix
 * @param {ff.Graph} graph
 * @param {number} row
 * @param {number} col
 */
firefly.Dashboard.prototype.addGraph = function(graph, row, col) {
	this.graphs_[row].splice(col, 0, graph);
	this.printGraphs_();
};


/**
 * remove a graph from the internal matrix
 * @param {ff.Graph} graph
 */
firefly.Dashboard.prototype.removeGraph = function(graph) {
	var dashboard = this;
	this.iterGraphs_(function(grph, row, col) {
		if (graph === grph) {
			graph.clear();
			dashboard.graphs_[row].splice(col, 1);
			return false;
		}
	});
};


/**
 * clear graphs from the internal matrix.
 * @param {number|undefined} row if provided, clear the entire row with index indicated by this param
 */
firefly.Dashboard.prototype.clearGraphs = function(row) {
	this.iterGraphs_(function(graph) {
		graph.clear();
	}, row);

	if (row === undefined) {
		this.graphs_ = [];
	} else {
		this.graphs_.splice(row, 1);
	}
};


/**
 * helper to iterate over the internal graph matrix
 * @param {function()} fxn a function that will be passed the graph, row and column
 * @row just iterate a particular row
 */
firefly.Dashboard.prototype.iterGraphs_ = function(fxn, row) {
	if (row === undefined) {
		var rowMin = 0;
		var rowMax = this.graphs_.length;
	} else {
		var rowMin = row;
		var rowMax = row + 1;
	}

	for (var row=rowMin; row < rowMax; row++) {
		for (var col=0; col < this.graphs_[row].length; col++) {
			var result = fxn(this.graphs_[row][col], row, col);
			if (result === false) return;
		}
	}
};


/**
 * get the row,col for a graph by finding it in the internal matrix
 * @param {ff.Graph} graph the graph instance to find
 */
firefly.Dashboard.prototype.findGraph = function(graph) {
	var result = null;
	this.iterGraphs_(function(grph, row, col) {
		if (graph === grph) {
			result = {'row': row, 'col': col};
			return false;
		}
	});
	return result;
};


/**
 * install some event listeners necessary for ordinary operation
 */
firefly.Dashboard.prototype.observeEvents = function() {
	var dashboard = this;

	// when the hash changes, we probably need to update the dashboard
	// TODO(bigo): convert to pushState
	$(window).bind('hashchange', function(evt) {
		// we keep a mutex so we don't get into infinite loops
		// TODO(bigo): better description
		if (!dashboard.hashchange_mutex_) {
			if (evt.fragment) {
				var fragment = decodeURIComponent(evt.fragment);
				// we use a shebang-style fragment, so slice off the '!'
				$.ajax({
					url: dashboard.makeURL_('expand/' + fragment.slice(1)),
					async: false,
					dataType: 'json',
					success: function(data) {
						dashboard.sync(data);
					}
				});
			}
		} else {
			// clear the mutex so future changes will be interpreted properly
			dashboard.hashchange_mutex_ = false;
		}
	});

	$(document).ready(function() {
		$(window).trigger('hashchange');
	});

	$(window).resize(function() {
		dashboard.view.adjustGraphHeights_();
	});
};


/**
 * install the timer that causes graphs to refresh
 */
firefly.Dashboard.prototype.unpauseUpdates_ = function() {
	var dashboard = this;

	this.intervalID_ = window.setInterval(function() {
		// don't update if the page is not visible to the user
		if (document.hidden || document.webkitHidden || document.mozHidden) {
			return;
		}

		dashboard.iterGraphs_(function(graph) {
			graph.updateGraph();
		});
	}, this.REGULAR_REFRESH_INTERVAL);
};


/**
 * stop updating graphs
 */
firefly.Dashboard.prototype.pauseUpdates_ = function() {
	window.clearInterval(this.intervalID_);
};


/**
 * invoke the GraphEditor interface
 * @param {ff.Graph} graph
 */
firefly.Dashboard.prototype.editGraph = function(graph) {
	this.pauseUpdates_();

	var dashboard = this;
	// TODO: have to make this stuff work once graphedit exists..
	new firefly.GraphEdit(graph, this.sources, this.makeURL_, {
		'onSave': function(serialized) {
			graph.sync(serialized);
			dashboard.serializeToBrowserHistory();
			dashboard.pauseUpdates_();
		},
		'onExit': function() {
			dashboard.unpauseUpdates_();
		}
	});
};

/**
 * serialize most graph state into a JSON-able object
 */
firefly.Dashboard.prototype.serialize = function() {
	var rows = [];
	for (var i=0; i<this.graphs_.length; i++) {
		var row = [];
		for (var j=0; j<this.graphs_[i].length; j++) {
			row.push(this.graphs_[i][j].serialize());
		}
		rows.push(row);
	}

	return {'columnCount': this.view.columnCount, 'rows': rows};
};


firefly.Dashboard.prototype.serializeToBrowserHistory = function() {
	var serialized = this.serialize();
	this.hashchange_mutex_ = true;
	$.ajax({
		url: this.makeURL_('shorten'),
		type: 'POST',
		async: false,
		contentType: 'application/json',
		data: JSON.stringify(serialized),
		success: function(data) {
			// merge mode 2 means overwrite
			$.bbq.pushState('!' + data, 2);
		}
	});
};

firefly.Dashboard.prototype.sync = function(serialized) {
	this.view.render(serialized);
};

/** create a new matrix where the specified graph is alone */
firefly.Dashboard.prototype.isolateGraph = function(graph) {
	var serialized = this.getIsolatedSerial(graph);
	this.sync(serialized);
	this.serializeToBrowserHistory();
};

/** get embed code without refreshing page */
firefly.Dashboard.prototype.getIsolatedSerial = function(graph) {
	var rows = [];
	var row = [];
	row.push(graph.serialize());
	rows.push(row);
	return {'columnCount': 1, 'rows': rows};
};

firefly.Dashboard.prototype.setColumnCount = function(columnCount) {

	// get the current serialized view of the graph
	var serialized = this.serialize();
	// and collapse the graphs down to a flattened array
	var graphs = serialized.rows.reduce(function(a,b) {return a.concat(b);}, []);

	// we're gonna re-slice the graphs according to our new column count
	var newRows = [];
	var rowCounter = columnCount;
	var row = [];

	for (var i=0; i < graphs.length; i++) {
		var graph = graphs[i];

		row.push(graph);
		rowCounter -= 1;

		// if we've filled out the row, push it the list and
		// move on to the next one
		if (rowCounter <= 0) {
			newRows.push(row);
			row = [];
			rowCounter = columnCount;
		}
	}

	// if we have a partial row, fill it out with blanks
	if (row.length) {
		for (var i=(columnCount - row.length); i>0;i--) {
			row.push((new firefly.Graph(null, this.sources, this.makeURL_)).serialize());
		}
		newRows.push(row);
	}

	serialized.columnCount = columnCount;
	serialized.rows = newRows;
	this.sync(serialized);
	this.serializeToBrowserHistory();
};

/**
 * class for the View component of the Dashboard
 * @constructor
 * @param {firefly.Dashboard} controller
 * @param {Element} container
 */
firefly.DashboardView = function(controller, container) {
	this.logger_ = goog.debug.Logger.getLogger('firefly.DashboardView');

	// clipboards for copying entire graphs or just their options
	this.clipboard_graph_ = null;
	this.clipboard_options_ = null;
	this.controller = controller;
	this.container = container;
	if (!this.controller.embedded_){
		this.observeEvents();
	}
};

/**
 * @type {goog.debug.Logger}
 * @protected
 */
firefly.DashboardView.prototype.logger_ = null;

firefly.DashboardView.prototype.columnCount = 3;

/**
 * setup delegate functions on this.container for actions that take place
 * on its descendents
 */
firefly.DashboardView.prototype.observeEvents = function() {
	var that = this;
	$(window).contextmenu({
		'container': this.container,
		'menu': function(evt) {
			return firefly.DashboardView.generateContextMenu_.apply(this, [that, evt]);
		}
	});

	$(this.container).delegate('[rel^=action-edit-sources]', 'click', function(evt) {
		var graph = $(this).closest('.graph').data('ff:graph');
		that.controller.editGraph(graph);
	});

	$(this.container).bind('ff:dashchange', function(evt) {
		that.controller.serializeToBrowserHistory();
		that.adjustGraphHeights_();
	});
};

/**
 * Helper to generate the context menu for the dashboard.
 * @param {firefly.DashboardView} instance
 * @param {Event} evt
 */
firefly.DashboardView.generateContextMenu_ = function(instance, evt) {
	var menuItems = [];

	var setZoom = function(graph, zoom) {
		if (graph) {
			graph.setZoom(zoom);
			$(instance.container).trigger('ff:dashchange');
		}
	};

	// if we're inside a cell, add cell options + row options
	var graphEl = $(this).closest('.graph');
	if (graphEl.length) {
		graphEl = graphEl.get(0);

		pasteGraphDisabled = instance.clipboard_graph_ ? false : true;
		if (typeof(Storage) !== "undefined") {
			pasteGraphDisabled = localStorage.getItem("firefly-clipboard") ? false : true;
		}

		menuItems.push.apply(menuItems, [
			{"label": "Graph", "header": true},
			{"label": "Edit Graph", "action": function() {
				instance.controller.editGraph($(evt.target).retrieveGraph());
			}},
			{'label': "Set Zoom", 'children': [
				{'label': "1 min", 'action': function() {setZoom($(evt.target).retrieveGraph(), "60");}},
				{'label': "5 mins", 'action': function() {setZoom($(evt.target).retrieveGraph(), "300");}},
				{'label': "30 mins", 'action': function() {setZoom($(evt.target).retrieveGraph(), "1800");}},
				{'label': "1 hour", 'action': function() {setZoom($(evt.target).retrieveGraph(), "3600");}},
				{'label': "3 hours", 'action': function() {setZoom($(evt.target).retrieveGraph(), "10800");}},
				{'label': "6 hours", 'action': function() {setZoom($(evt.target).retrieveGraph(), "21600");}},
				{'label': "12 hours", 'action': function() {setZoom($(evt.target).retrieveGraph(), "43200");}},
				{'label': "1 day", 'action': function() {setZoom($(evt.target).retrieveGraph(), "86400");}},
				{'label': "2 days", 'action': function() {setZoom($(evt.target).retrieveGraph(), "172800");}},
				{'label': "3 days", 'action': function() {setZoom($(evt.target).retrieveGraph(), "259200");}},
				{'label': "7 days", 'action': function() {setZoom($(evt.target).retrieveGraph(), "604800");}},
				{'label': "14 days", 'action': function() {setZoom($(evt.target).retrieveGraph(), "1209600");}},
				{'label': "1 month", 'action': function() {setZoom($(evt.target).retrieveGraph(), "2592000");}},
				{'label': "6 months", 'action': function() {setZoom($(evt.target).retrieveGraph(), "15768000");}},
				{'label': "1 year", 'action': function() {setZoom($(evt.target).retrieveGraph(), "31536000");}},
				{'label': "custom", 'action': function() {setZoom($(evt.target).retrieveGraph(), prompt("Zoom in seconds"));}},
			]},
			{'label': "Make Zoom Global", 'action': function() {
				var from = $(evt.target).retrieveGraph();
				from && $('.graph').each( function() {
					to = $(this).retrieveGraph();
					to && to.setZoom(from.zoom);
				});
				$(instance.container).trigger('ff:dashchange');
			}},
			{"label": "Cut Graph", "action": function() {
				var graph = $(evt.target).retrieveGraph();
				instance.clipboard_graph_ = graph.serialize();
				if (typeof(Storage) !== "undefined") {
					localStorage.setItem("firefly-clipboard", JSON.stringify($(evt.target).retrieveGraph().serialize()));
				}
				graph.clear();
				$(instance.container).trigger('ff:dashchange');
			}},
			{"label": "Copy Graph", "action": function() {
				instance.clipboard_graph_ = $(evt.target).retrieveGraph().serialize();
				if (typeof(Storage) !== "undefined") {
					localStorage.setItem("firefly-clipboard", JSON.stringify($(evt.target).retrieveGraph().serialize()));
				}
			}},
			{"label": "Paste Graph", "disabled": pasteGraphDisabled, "action": function() {
				if (typeof(Storage) !== "undefined") {
					var graph = JSON.parse(localStorage.getItem("firefly-clipboard"));
					$(evt.target).retrieveGraph().sync(graph);
				} else {
					$(evt.target).retrieveGraph().sync(instance.clipboard_graph_);
				}
				$(instance.container).trigger('ff:dashchange');
			}},
			{"label": "Isolate Graph", "action": function() {
				var graph = $(evt.target).retrieveGraph();
				instance.controller.isolateGraph(graph);
			}},
			{"label": "Embed Graph", "action": function() {
				var graph = $(evt.target).retrieveGraph();
				var serial = instance.controller.getIsolatedSerial(graph);
				$.ajax({
					url: instance.controller.makeURL_('shorten'),
					type: 'post',
					async: true,
					contentType: 'application/json',
					data: JSON.stringify(serial),
					success: function(data) {
						var loc = $(location).attr('href');
						var nurl = $.param.querystring(loc, 'embed=true');
						nurl = $.param.fragment(nurl, '!' + data,2);
						var link = 'Set link as iframe src to embed: <a href="'+nurl+'">'+nurl+'</a>'
						new firefly.GraphModal({'title': 'Embed url', 'content': link});
					}
				});
			}},
			{"label": "Copy Graph Options", "action": function() {
				instance.clipboard_options_ = $(evt.target).retrieveGraph().serialize().options;
			}},
			{"label": "Paste Graph Options", "disabled": (instance.clipboard_options_ ? false : true), "action": function() {
				$(evt.target).retrieveGraph().syncOptions(instance.clipboard_options_);
				$(instance.container).trigger('ff:dashchange');
			}}
		]);

		menuItems.push.apply(menuItems, [
			{'label': "Row", 'header': true},
			{'label': "Add Row Above", 'action': function() {
				var relativeTR = $(evt.target).closest('tr').prev('tr').get(0);
				instance.addTableRow(relativeTR);
				$(instance.container).trigger('ff:dashchange');
			}},
			{'label': "Add Row Below", 'action': function() {
				var relativeTR = $(evt.target).closest('tr').get(0);
				instance.addTableRow(relativeTR);
				$(instance.container).trigger('ff:dashchange');
			}},
			{'label': "Delete Row", 'action': function() {
				var relativeTR = $(evt.target).closest('tr');
				var siblingTRs = relativeTR.siblings('tr');

				var rowIndex = relativeTR.index();
				instance.controller.iterGraphs_(function(graph) {
					graph.clear();
				}, rowIndex);

				if (siblingTRs.length > 0) {
					instance.controller.clearGraphs(rowIndex);
					$(relativeTR).remove();
				}

				$(instance.container).trigger('ff:dashchange');
			}}
		]);

	}

	menuItems.push.apply(menuItems, [
		{'label': "Global", 'header': true},
		{'label': "Set Column Count", 'children': [
			{'label': "1 Col", 'action': function() {instance.controller.setColumnCount(1);}},
			{'label': "2 Col", 'action': function() {instance.controller.setColumnCount(2);}},
			{'label': "3 Col", 'action': function() {instance.controller.setColumnCount(3);}},
			{'label': "4 Col", 'action': function() {instance.controller.setColumnCount(4);}},
			{'label': "5 Col", 'action': function() {instance.controller.setColumnCount(5);}}
		]},
		{'label': "Save to Name", 'action': function() {
			var footer = $('<div>');
			var content = $('<div>');
			var namebox = $('<input>');
			namebox.attr('type', 'text');

			var incoming = $.deparam.querystring().incoming;
			if (incoming) {
				content.append($('<p>').text('You came to this state from a saved graph.  The name is entered below.'));
				namebox.val(incoming);
			}
			else {
				content.append($('<p>').text('Enter a name to save this graph to.'));
			}

			content.append(namebox);
			var flash = $('<div>');
			content.append(flash);

			var onsave = function() {
				$.ajax({
					url: instance.controller.makeURL_('named/' + namebox.val()),
					type: 'put',
					async: true,
					contentType: 'application/json',
					data: JSON.stringify({'frag': $(location).attr('hash'), 'confirmed': $('.graphmodal button.save').hasClass('confirm')}),
					success: function(jqXHR) {
						var namedurl = $(location).attr('protocol') + '//' + $(location).attr('host') + jqXHR;
						flash.html('<p class="success">This dashboard is: </p>');
						flash.append($('<a>').attr('href', namedurl).text(namedurl));
						footer.empty().html('<button rel="modal-close" class="pseudo-link">Close</button>');
					},
					error: function(jqXHR) {
						if (jqXHR.status == 409) {
							flash.html('<p class="warning">This name is already in use.</p>');
							$('.graphmodal button.save').text('Confirm Overwrite').addClass('confirm');

						}
						else {
							flash.html('<p class="error">Save Failed: </p>');
							flash.append(jqXHR.responseText);
						}
					}});
			};

			new firefly.GraphModal({'title': 'Save to Name',
						'content': content,
						'footer': footer,
						'actions': [
							{'name': 'Cancel', 'type': 'close'},
							{'name': 'Save', 'action': onsave, 'type': 'save'}
						]});
		}}
	]);
	return menuItems;
};

/**
 * render the GraphDash table.
 * @param {Object} serializedDash is the serialized version of the dash (as a proper javascript array),
 * and if left off the dash will be rendered in its default starting state.
 */
firefly.DashboardView.prototype.render = function(serialized) {
	if (serialized !== undefined) {
		this.columnCount = serialized.columnCount || this.columnCount;
	}
	this.createBaseTable();
	this.controller.clearGraphs();

	// if we're restoring a serialized dash, set it up a row at a time
	if (serialized !== undefined) {
		this.columnCount = serialized.columnCount || this.columnCount;
		var rows = serialized.rows;

		for (var i=rows.length-1; i>=0; i--) {
			this.addTableRow(null, rows[i]);
		}

	// otherwise, just add the default single blank row
	} else {

		this.addTableRow();
	}
};

/**
 * Called to adjust heights of graphs on the page.
 * Should only need to be called after adding or removing rows,
 * or resizing the page.
 */
firefly.DashboardView.prototype.adjustGraphHeights_ = function() {
	var numRows = this.controller.graphs_.length;
	var pageHeight = $(window).height();
	this.targetRowHeight_ = Math.max(pageHeight / numRows, this.controller.MINIMUM_GRAPH_HEIGHT);
	this.logger_.fine("adjustGraphHeights_(): " + numRows + " rows, " + pageHeight + " pageHeight, " + this.targetRowHeight_ + " targetRowHeight");

	// make all the graphs redraw themselves at appropriate heights
	// TODO: if previous height was larger, redraw graphs then resize containers,
	//       and if previous height was smaller, resize first then redraw.
	var view = this;
	this.controller.iterGraphs_(function(graph) {
		graph.setHeight(view.targetRowHeight_);
	});

	// TODO(bigo): this -2 is to account for the 1px table cell borders;
	//             it'd be nice if it was introspected rather than hardcoded.
	$('.graph').height(this.targetRowHeight_ - 2);
};

/**
 * create the table that actually holds the displayed graphs -
 * basically the main container
 */
firefly.DashboardView.prototype.createBaseTable = function() {
	var table = $('<table class="dashboard">').attr({'cellspacing': 0, 'cellpadding': 0});
	var thead = $('<thead>').appendTo(table);
	var tr = $('<tr>');
	for (var i=0; i < this.columnCount; i++) {
		tr.append($('<td>').width((1 / this.columnCount * 100) + "%"))
	}
	thead.append(tr);

	var tbody = $('<tbody>').appendTo(table);
	this.tbody = tbody.get(0);
	$(this.container).empty().append(table);
};

/**
 * add a new row to the graph container table.
 * @param {Element} anchorRow the new row will be added *after* this, or *prepended* to the table if not provided
 * @param {Object} serializedGraphs the serialized graphs to initialize the row with
 */
firefly.DashboardView.prototype.addTableRow = function(anchorRow, serializedGraphs) {
	var row = $("<tr>").attr("class", "graph-row");

	if (serializedGraphs) {
		for (var i=0; i < serializedGraphs.length; i++) {
			var graph = serializedGraphs[i];
			var cell = $("<td>")
				.attr({
					'class': 'graph'
				})
			cell.appendTo(row);
		}
	} else {
		for (var i=0; i < this.columnCount; i++ ) {
			var cell = $('<td class="graph">');
			cell.appendTo(row);
		}
	}
	anchorRow && $(anchorRow).after(row) || $(this.tbody).prepend(row);

	var controller = this.controller;
	var view = this;

	var graphRow = [];

	row.children().each(function(i, td) {
		// it's possible we're syncing from a serialized dash that doesn't
		// have enough graphs in a row, so be safe here
		if (serializedGraphs && (i < serializedGraphs.length)) {
			var graph = new firefly.Graph(td, controller.sources, controller.makeURL_, serializedGraphs[i], view.targetRowHeight_);
		} else {
			var graph = new firefly.Graph(td, controller.sources, controller.makeURL_, null, view.targetRowHeight_);
		}

		graphRow.push(graph);

		if (i > 0) {
			graphRow[i-1].next = graph;
			graph.prev = graphRow[i-1];
		}
	});

	this.controller.graphs_.splice(row.index(), 0, graphRow);
	this.adjustGraphHeights_();
};


(function($) {
	$.fn.retrieveGraph = function() {
		if (this.length) {
			return this.closest('.graph').data('ff:graph');
		}
	};
}(jQuery));
