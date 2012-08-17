(function($) {

	var menuEl = null;

	var constructMenuDOM = function(menu, evt) {
		var ul = document.createElement('ul');
		ul.className = "contextmenu";

		if (menu.constructor === Function.prototype.constructor) {
			var items = menu.apply(evt.target, [evt]);
		} else {
			var items = menu;
		}

		for (var i=0; i<items.length; i++) {
			var item = items[i];
			var li = document.createElement('li');
			if (item.disabled) {
				var holder = $("<span class='disabled'>").get(0);
			} else if (item.header) {
				var holder = $("<span class='header'>").get(0);
			} else {
				var holder = $("<a>").get(0);
			}
			holder.innerHTML = item.label;
			$(holder).attr(item.attrs);
			if (item.action) {
				$(holder).click(item.action);
			}
			if (item.children) {
				var evtHandlerFactory = function(children) {
					return function(evt) {
						showSubMenu.apply(this, [children, evt]);
					}
				};
				$(holder).mouseenter(evtHandlerFactory(item.children));
				$(li).mouseleave( function () {
					$(this).data('collapse', true);
					var that = this;
					var collapseMe = function() { if ( $(that).data('collapse') ) $(that).children('ul').remove(); };
					window.setTimeout(collapseMe, 250);
				});
				$(li).mouseenter( function () { $(this).data('collapse', false); });
			}
			li.appendChild(holder);
			ul.appendChild(li);
		}

		return ul;

	};

	var showSubMenu = function(menu, evt) {
		var ul = constructMenuDOM(menu, evt);
		var parentMenu = $(this).closest('ul');
		var parentTop = parentMenu.offset().top - $(window).scrollTop();
		var thisPos = $(this).position();

		this.parentNode.appendChild(ul);
		var topval = (parentTop + thisPos.top > $(window).height() - $(ul).height()) ? thisPos.top - $(ul).height() + $(this).height() : thisPos.top;
		$(ul).css({
			'left': thisPos.left + $(parentMenu).width() + 'px',
			'top': topval + 'px'
		});
	};

	var showMenu = function(menu, evt, touchMode) {
		if (menuEl) closeMenu();

		var ul = constructMenuDOM(menu, evt);
		document.body.appendChild(ul);
		menuEl = ul;

		var clientY = evt.clientY || evt.originalEvent.touches[0].clientY;
		var pageY   = evt.pageY   || evt.originalEvent.touches[0].pageY;
		var pageX   = evt.pageX   || evt.originalEvent.touches[0].pageX;
		if (clientY + $(ul).height() > $(window).height()) {
			var topval = pageY - $(ul).height();
		} else {
			var topval = pageY;
		}
		$(ul).css({'left': pageX + 'px', 'top': topval + 'px'});

		if (!touchMode) {
			$(window).one('mousedown', function(evt) {
				closeMenu();
			});
		}
		$(menuEl).mousedown(function(evt) {
			evt.cancelBubble = true;
			if (evt.stopPropagation) evt.stopPropagation();
		});
		$(menuEl).click(function(evt) {
			closeMenu();
		});
		
	};

	var closeMenu = function(items) {
		$(menuEl).remove();
		menuEl = null;
	};
	
	$.fn.contextmenu = function(options) {
		options = options || {};
		return this.each(function() {
			var lastStart, fingerMoved, stillTouching;

			function checkTouchHold(start, evt) {
				if (stillTouching && !fingerMoved && start === lastStart) {
					showMenu(options.menu, evt, true);
				}
			}

			$(this).bind("contextmenu", function(evt) {
				if (evt.metaKey) return true;
				showMenu(options.menu, evt);
				return false;
			});
			$(this).bind("touchstart", function(evt) {
				var now = Date.now();
				lastStart = now;
				fingerMoved = false;
				stillTouching = true;

				setTimeout(function() { checkTouchHold(now, evt); }, 1000);
			});
			$(this).bind("touchmove", function(evt) {
				fingerMoved = true;
			});
			$(this).bind("touchend", function(evt) {
				stillTouching = false;
			});
		});
	};
}(jQuery));
