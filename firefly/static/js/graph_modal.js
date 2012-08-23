goog.provide("firefly.GraphModal");

goog.require('goog.debug.Logger');


/**
 * @constructor
 */
firefly.GraphModal = function(options) {
	this.logger_ = goog.debug.Logger.getLogger('firefly.GraphModal');

	var defaults = {
		'title': 'Firefly',
		'actions': [],
		'contents': undefined
	};

	options = $.extend(defaults, options);

	this._container = this.createDOM(options);
	this.observeEvents();
	$(this._container).css('display', 'none');
	document.body.appendChild(this._container);

	$(this._container).overlay({
		mask: {
			color: '#777',
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
}

/**
 * @type {goog.debug.Logger}
 * @protected
 */
firefly.GraphModal.prototype.logger_ = null;


/**
 * observe events on the modal dialog
 */
firefly.GraphModal.prototype.observeEvents = function() {
	var that = this;

	$(document).bind("keydown", function(evt) {
		// listen for the esc key, close without saving
		if (evt.which == 27) that.close(false);
	});

	$(this._container).delegate('[rel=cancel]', 'click', function(evt) {
		// close without saving the graph
		that.close(false);
	});

	$(this._container).delegate('[rel=close]', 'click', function(evt) {
		that.close(false);
	});
};

/**
 * close the entire edit pane
 */
firefly.GraphModal.prototype.close = function(save) {
	$(this._container).data('overlay').close();
	$(this._container).remove();
	$(document).unbind("keydown");
};

firefly.GraphModal._domTemplate = $([
	"<div class='graphmodal'>",
		"<div class='header'>",
		"<button class='pseudo-link' rel='close'>x</button>",
		"</div>",
		"<div class='content'>",
		"</div>",
		"<div class='footer'>",
		"</div>",
	"</div>"].join('')).get(0);

/**
 * create the DOM for a top-level source list
 */
firefly.GraphModal.prototype.createDOM = function(options) {
	var div = $(firefly.GraphModal._domTemplate).clone().get(0);

	var header = $(div).find('.header');
	var content = $(div).find('.content');
	var footer= $(div).find('.footer');

	header.append($('<h2>').text(options.title));
	content.append(options.content);

	$.each(options.actions, function(idx, action) {
		var button = $('<button>');
		button.addClass('pseudo-link');
		button.text(action.name);
		if (action.action == 'close') {
			button.attr('rel', 'cancel');
		}
		else {
			button.click(action.action);
		}
		footer.append(button);
	});

	return div;
};
