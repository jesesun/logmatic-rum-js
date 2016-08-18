/*
 * Copyright (c) 2011, Yahoo! Inc.  All rights reserved.
 * Copyright (c) 2012, Log-Normal, Inc.  All rights reserved.
 * Copyright (c) 2014, SOASTA, Inc. All rights reserved.
 * Copyrights licensed under the BSD License. See the accompanying LICENSE.txt file for terms.
 */

/**
\file boomerang.js
boomerang measures various performance characteristics of your user's browsing
experience and beacons it back to your server.

\details
To use this you'll need a web site, lots of users and the ability to do
something with the data you collect.  How you collect the data is up to
you, but we have a few ideas.
*/

// Measure the time the script started
// This has to be global so that we don't wait for the entire
// BOOMR function to download and execute before measuring the
// time.  We also declare it without `var` so that we can later
// `delete` it.  This is the only way that works on Internet Explorer
BOOMR_start = new Date().getTime();

/**
 Check the value of document.domain and fix it if incorrect.
 This function is run at the top of boomerang, and then whenever
 init() is called.  If boomerang is running within an iframe, this
 function checks to see if it can access elements in the parent
 iframe.  If not, it will fudge around with document.domain until
 it finds a value that works.

 This allows customers to change the value of document.domain at
 any point within their page's load process, and we will adapt to
 it.
 */
function BOOMR_check_doc_domain(domain) {
	/*eslint no-unused-vars:0*/
	var test;

	// If domain is not passed in, then this is a global call
	// domain is only passed in if we call ourselves, so we
	// skip the frame check at that point
	if (!domain) {
		// If we're running in the main window, then we don't need this
		if (window.parent === window || !document.getElementById("boomr-if-as")) {
			return;// true;	// nothing to do
		}

		if (window.BOOMR && BOOMR.boomerang_frame && BOOMR.window) {
			try {
				// If document.domain is changed during page load (from www.blah.com to blah.com, for example),
				// BOOMR.window.location.href throws "Permission Denied" in IE.
				// Resetting the inner domain to match the outer makes location accessible once again
				if (BOOMR.boomerang_frame.document.domain !== BOOMR.window.document.domain) {
					BOOMR.boomerang_frame.document.domain = BOOMR.window.document.domain;
				}
			}
			catch(err) {
				if (!BOOMR.isCrossOriginError(err)) {
					BOOMR.addError(err, "BOOMR_check_doc_domain.domainFix");
				}
			}
		}
		domain = document.domain;
	}

	if (domain.indexOf(".") === -1) {
		return;// false;	// not okay, but we did our best
	}

	// 1. Test without setting document.domain
	try {
		test = window.parent.document;
		return;// test !== undefined;	// all okay
	}
	// 2. Test with document.domain
	catch (err) {
		document.domain = domain;
	}
	try {
		test = window.parent.document;
		return;// test !== undefined;	// all okay
	}
	// 3. Strip off leading part and try again
	catch (err) {
		domain = domain.replace(/^[\w\-]+\./, "");
	}

	BOOMR_check_doc_domain(domain);
}

BOOMR_check_doc_domain();


// beaconing section
// the parameter is the window
(function(w) {

	var impl, boomr, d, myurl, createCustomEvent, dispatchEvent, visibilityState, visibilityChange, orig_w = w;

	// This is the only block where we use document without the w. qualifier
	if (w.parent !== w
			&& document.getElementById("boomr-if-as")
			&& document.getElementById("boomr-if-as").nodeName.toLowerCase() === "script") {
		w = w.parent;
		myurl = document.getElementById("boomr-if-as").src;
	}

	d = w.document;

	// Short namespace because I don't want to keep typing BOOMERANG
	if (!w.BOOMR) { w.BOOMR = {}; }
	BOOMR = w.BOOMR;
	// don't allow this code to be included twice
	if (BOOMR.version) {
		return;
	}

	BOOMR.version = "0.9";
	BOOMR.window = w;
	BOOMR.boomerang_frame = orig_w;

	if (!BOOMR.plugins) { BOOMR.plugins = {}; }

	// CustomEvent proxy for IE9 & 10 from https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent
	(function() {
		try {
			if (new w.CustomEvent("CustomEvent") !== undefined) {
				createCustomEvent = function(e_name, params) {
					return new w.CustomEvent(e_name, params);
				};
			}
		}
		catch (ignore) {
			// empty
		}

		try {
			if (!createCustomEvent && d.createEvent && d.createEvent( "CustomEvent" )) {
				createCustomEvent = function(e_name, params) {
					var evt = d.createEvent( "CustomEvent" );
					params = params || { cancelable: false, bubbles: false };
					evt.initCustomEvent( e_name, params.bubbles, params.cancelable, params.detail );

					return evt;
				};
			}
		}
		catch (ignore) {
			// empty
		}

		if (!createCustomEvent && d.createEventObject) {
			createCustomEvent = function(e_name, params) {
				var evt = d.createEventObject();
				evt.type = evt.propertyName = e_name;
				evt.detail = params.detail;

				return evt;
			};
		}

		if (!createCustomEvent) {
			createCustomEvent = function() { return undefined; };
		}
	}());

	/**
	 dispatch a custom event to the browser
	 @param e_name	The custom event name that consumers can subscribe to
	 @param e_data	Any data passed to subscribers of the custom event via the `event.detail` property
	 @param async	By default, custom events are dispatched immediately.
			Set to true if the event should be dispatched once the browser has finished its current
			JavaScript execution.
	 */
	dispatchEvent = function(e_name, e_data, async) {
		var ev = createCustomEvent(e_name, {"detail": e_data});
		if (!ev) {
			return;
		}

		function dispatch() {
			if (d.dispatchEvent) {
				d.dispatchEvent(ev);
			}
			else if (d.fireEvent) {
				d.fireEvent("onpropertychange", ev);
			}
		}

		if (async) {
			BOOMR.setImmediate(dispatch);
		}
		else {
			dispatch();
		}
	};

	// visibilitychange is useful to detect if the page loaded through prerender
	// or if the page never became visible
	// http://www.w3.org/TR/2011/WD-page-visibility-20110602/
	// http://www.nczonline.net/blog/2011/08/09/introduction-to-the-page-visibility-api/
	// https://developer.mozilla.org/en-US/docs/Web/Guide/User_experience/Using_the_Page_Visibility_API

	// Set the name of the hidden property and the change event for visibility
	if (typeof document.hidden !== "undefined") { // Opera 12.10 and Firefox 18 and later support
		visibilityState = "visibilityState";
		visibilityChange = "visibilitychange";
	}
	else if (typeof document.mozHidden !== "undefined") {
		visibilityState = "mozVisibilityState";
		visibilityChange = "mozvisibilitychange";
	}
	else if (typeof document.msHidden !== "undefined") {
		visibilityState = "msVisibilityState";
		visibilityChange = "msvisibilitychange";
	}
	else if (typeof document.webkitHidden !== "undefined") {
		visibilityState = "webkitVisibilityState";
		visibilityChange = "webkitvisibilitychange";
	}


	// impl is a private object not reachable from outside the BOOMR object
	// users can set properties by passing in to the init() method
	impl = {
		// properties
		beacon_url: "",
		// beacon request method, either GET, POST or AUTO. AUTO will check the
		// request size then use GET if the request URL is less than 2000 chars
		// otherwise it will fall back to a POST request.
		beacon_type: "AUTO",
		// strip out everything except last two parts of hostname.
		// This doesn't work well for domains that end with a country tld,
		// but we allow the developer to override site_domain for that.
		// You can disable all cookies by setting site_domain to a falsy value
		site_domain: w.location.hostname.
					replace(/.*?([^.]+\.[^.]+)\.?$/, "$1").
					toLowerCase(),
		//! User's ip address determined on the server.  Used for the BA cookie
		user_ip: "",
		// Whether or not to send beacons on page load
		autorun: true,

		strip_query_string: false,

		onloadfired: false,

		handlers_attached: false,
		events: {
			"page_ready": [],
			"page_unload": [],
			"before_unload": [],
			"dom_loaded": [],
			"visibility_changed": [],
			"before_beacon": [],
			"onbeacon": [],
			"xhr_load": [],
			"click": [],
			"form_submit": []
		},

		public_events: {
			"before_beacon": "onBeforeBoomerangBeacon",
			"onbeacon": "onBoomerangBeacon",
			"onboomerangloaded": "onBoomerangLoaded"
		},

		vars: {},

		errors: {},

		disabled_plugins: {},

		xb_handler: function(type) {
			return function(ev) {
				var target;
				if (!ev) { ev = w.event; }
				if (ev.target) { target = ev.target; }
				else if (ev.srcElement) { target = ev.srcElement; }
				if (target.nodeType === 3) {// defeat Safari bug
					target = target.parentNode;
				}

				// don't capture events on flash objects
				// because of context slowdowns in PepperFlash
				if (target && target.nodeName.toUpperCase() === "OBJECT" && target.type === "application/x-shockwave-flash") {
					return;
				}
				impl.fireEvent(type, target);
			};
		},

		fireEvent: function(e_name, data) {
			var i, handler, handlers;

			e_name = e_name.toLowerCase();

			if (!this.events.hasOwnProperty(e_name)) {
				return;// false;
			}

			if (this.public_events.hasOwnProperty(e_name)) {
				dispatchEvent(this.public_events[e_name], data);
			}

			handlers = this.events[e_name];

			for (i=0; i<handlers.length; i++) {
				try {
					handler = handlers[i];
					handler.fn.call(handler.scope, data, handler.cb_data);
				}
				catch (err) {
					BOOMR.addError(err, "fireEvent." + e_name + "<" + i + ">");
				}
			}

			return;// true;
		}
	};


	// We create a boomr object and then copy all its properties to BOOMR so that
	// we don't overwrite anything additional that was added to BOOMR before this
	// was called... for example, a plugin.
	boomr = {
		t_lstart: null,
		t_start: BOOMR_start,
		t_end: null,
		//! t_pload: Value of the BOOMR_onload set in the host page
		t_onload: undefined,

		url: myurl,

		// Utility functions
		utils: {
			objectToString: function(o, separator, nest_level) {
				var value = [], k;

				if (!o || typeof o !== "object") {
					return o;
				}
				if (separator === undefined) {
					separator="\n\t";
				}
				if (!nest_level) {
					nest_level=0;
				}

				if (Object.prototype.toString.call(o) === "[object Array]") {
					for (k=0; k<o.length; k++) {
						if (nest_level > 0 && o[k] !== null && typeof o[k] === "object") {
							value.push(
								this.objectToString(
									o[k],
									separator + (separator === "\n\t" ? "\t" : ""),
									nest_level-1
								)
							);
						}
						else {
							if (separator === "&") {
								value.push(encodeURIComponent(o[k]));
							}
							else {
								value.push(o[k]);
							}
						}
					}
					separator = ",";
				}
				else {
					for (k in o) {
						if (Object.prototype.hasOwnProperty.call(o, k)) {
							if (nest_level > 0 && o[k] !== null && typeof o[k] === "object") {
								value.push(encodeURIComponent(k) + "=" +
									this.objectToString(
										o[k],
										separator + (separator === "\n\t" ? "\t" : ""),
										nest_level-1
									)
								);
							}
							else {
								if (separator === "&") {
									value.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k]));
								}
								else {
									value.push(k + "=" + o[k]);
								}
							}
						}
					}
				}

				return value.join(separator);
			},

			getCookie: function(name) {
				if (!name) {
					return null;
				}

				name = " " + name + "=";

				var i, cookies;
				cookies = " " + d.cookie + ";";
				if ( (i=cookies.indexOf(name)) >= 0 ) {
					i += name.length;
					cookies = cookies.substring(i, cookies.indexOf(";", i)).replace(/^"/, "").replace(/"$/, "");
					return cookies;
				}

				return null;
			},

			setCookie: function(name, subcookies, max_age) {
				var value, nameval, savedval, c, exp;

				if (!name || !impl.site_domain) {
					BOOMR.debug("No cookie name or site domain: " + name + "/" + impl.site_domain);
					return false;
				}

				value = this.objectToString(subcookies, "&");
				nameval = name + "=\"" + value + "\"";

				c = [nameval, "path=/", "domain=" + impl.site_domain];
				if (max_age) {
					exp = new Date();
					exp.setTime(exp.getTime() + max_age*1000);
					exp = exp.toGMTString();
					c.push("expires=" + exp);
				}

				if ( nameval.length < 500 ) {
					d.cookie = c.join("; ");
					// confirm cookie was set (could be blocked by user's settings, etc.)
					savedval = this.getCookie(name);
					if (value === savedval) {
						return true;
					}
					BOOMR.warn("Saved cookie value doesn't match what we tried to set:\n" + value + "\n" + savedval);
				}
				else {
					BOOMR.warn("Cookie too long: " + nameval.length + " " + nameval);
				}

				return false;
			},

			getSubCookies: function(cookie) {
				var cookies_a,
				    i, l, kv,
				    gotcookies=false,
				    cookies={};

				if (!cookie) {
					return null;
				}

				if (typeof cookie !== "string") {
					BOOMR.debug("TypeError: cookie is not a string: " + typeof cookie);
					return null;
				}

				cookies_a = cookie.split("&");

				for (i=0, l=cookies_a.length; i<l; i++) {
					kv = cookies_a[i].split("=");
					if (kv[0]) {
						kv.push("");	// just in case there's no value
						cookies[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
						gotcookies=true;
					}
				}

				return gotcookies ? cookies : null;
			},

			removeCookie: function(name) {
				return this.setCookie(name, {}, -86400);
			},

			cleanupURL: function(url) {
				if (!url || Object.prototype.toString.call(url) === "[object Array]") {
					return "";
				}
				if (impl.strip_query_string) {
					return url.replace(/\?.*/, "?qs-redacted");
				}
				return url;
			},

			hashQueryString: function(url, stripHash) {
				if (!url) {
					return url;
				}
				if (!url.match) {
					BOOMR.addError("TypeError: Not a string", "hashQueryString", typeof url);
					return "";
				}
				if (url.match(/^\/\//)) {
					url = location.protocol + url;
				}
				if (!url.match(/^(https?|file):/)) {
					BOOMR.error("Passed in URL is invalid: " + url);
					return "";
				}
				if (stripHash) {
					url = url.replace(/#.*/, "");
				}
				if (!BOOMR.utils.MD5) {
					return url;
				}
				return url.replace(/\?([^#]*)/, function(m0, m1) { return "?" + (m1.length > 10 ? BOOMR.utils.MD5(m1) : m1); });
			},

			pluginConfig: function(o, config, plugin_name, properties) {
				var i, props=0;

				if (!config || !config[plugin_name]) {
					return false;
				}

				for (i=0; i<properties.length; i++) {
					if (config[plugin_name][properties[i]] !== undefined) {
						o[properties[i]] = config[plugin_name][properties[i]];
						props++;
					}
				}

				return (props>0);
			},
			/**
			 * `filter` for arrays
			 *
			 * @private
			 * @param {Array} array The array to iterate over.
			 * @param {Function} predicate The function invoked per iteration.
			 * @returns {Array} Returns the new filtered array.
			 */
			arrayFilter: function(array, predicate) {
				var result = [];

				if (typeof array.filter === "function") {
					result = array.filter(predicate);
				}
				else {
					var index = -1,
					    length = array.length,
					    value;

					while (++index < length) {
						value = array[index];
						if (predicate(value, index, array)) {
							result[result.length] = value;
						}
					}
				}
				return result;
			},
			/**
			 Add a MutationObserver for a given element and terminate after `timeout`ms.
			 @param el		DOM element to watch for mutations
			 @param config		MutationObserverInit object (https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver#MutationObserverInit)
			 @param timeout		Number of milliseconds of no mutations after which the observer should be automatically disconnected
						If set to a falsy value, the observer will wait indefinitely for Mutations.
			 @param callback	Callback function to call either on timeout or if mutations are detected.  The signature of this method is:
							function(mutations, callback_data)
						Where:
							mutations is the list of mutations detected by the observer or `undefined` if the observer timed out
							callback_data is the passed in `callback_data` parameter without modifications

						The callback function may return a falsy value to disconnect the observer after it returns, or a truthy value to
						keep watching for mutations. If the return value is numeric and greater than 0, then this will be the new timeout
						if it is boolean instead, then the timeout will not fire any more so the caller MUST call disconnect() at some point
			 @param callback_data	Any data to be passed to the callback function as its second parameter
			 @param callback_ctx	An object that represents the `this` object of the `callback` method.  Leave unset the callback function is not a method of an object

			 @returns	- `null` if a MutationObserver could not be created OR
					- An object containing the observer and the timer object:
					  { observer: <MutationObserver>, timer: <Timeout Timer if any> }

					The caller can use this to disconnect the observer at any point by calling `retval.observer.disconnect()`
					Note that the caller should first check to see if `retval.observer` is set before calling `disconnect()` as it may
					have been cleared automatically.
			 */
			addObserver: function(el, config, timeout, callback, callback_data, callback_ctx) {
				var o = {observer: null, timer: null};

				if (!window.MutationObserver || !callback || !el) {
					return null;
				}

				function done(mutations) {
					var run_again=false;

					if (o.timer) {
						clearTimeout(o.timer);
						o.timer = null;
					}

					if (callback) {
						run_again = callback.call(callback_ctx, mutations, callback_data);

						if (!run_again) {
							callback = null;
						}
					}

					if (!run_again && o.observer) {
						o.observer.disconnect();
						o.observer = null;
					}

					if (typeof run_again === "number" && run_again > 0) {
						o.timer = setTimeout(done, run_again);
					}
				}

				o.observer = new MutationObserver(done);

				if (timeout) {
					o.timer = setTimeout(done, o.timeout);
				}

				o.observer.observe(el, config);

				return o;
			},

			addListener: function(el, type, fn) {
				if (el.addEventListener) {
					el.addEventListener(type, fn, false);
				}
				else if (el.attachEvent) {
					el.attachEvent( "on" + type, fn );
				}
			},

			removeListener: function(el, type, fn) {
				if (el.removeEventListener) {
					el.removeEventListener(type, fn, false);
				}
				else if (el.detachEvent) {
					el.detachEvent("on" + type, fn);
				}
			},

			pushVars: function(form, vars, prefix) {
				var k, i, l=0, input;

				for (k in vars) {
					if (vars.hasOwnProperty(k)) {
						if (Object.prototype.toString.call(vars[k]) === "[object Array]") {
							for (i = 0; i < vars[k].length; ++i) {
								l += BOOMR.utils.pushVars(form, vars[k][i], k + "[" + i + "]");
							}
						}
						else {
							input = document.createElement("input");
							input.type = "hidden";	// we need `hidden` to preserve newlines. see commit message for more details
							input.name = (prefix ? (prefix + "[" + k + "]") : k);
							input.value = (vars[k]===undefined || vars[k]===null ? "" : vars[k]);

							form.appendChild(input);

							l += encodeURIComponent(input.name).length + encodeURIComponent(input.value).length + 2;
						}
					}
				}

				return l;
			},

			sendData: function(form, method) {
				var input = document.createElement("input"),
				    urls = [ impl.beacon_url ];

				form.method = method;
				form.id = "beacon_form";

				// TODO: Determine if we want to send as JSON
				//if (window.JSON) {
				//	form.innerHTML = "";
				//	form.enctype = "text/plain";
				//	input.name = "data";
				//	input.value = JSON.stringify(impl.vars);
				//	form.appendChild(input);
				//} else {
				form.enctype = "application/x-www-form-urlencoded";
				//}

				if (impl.secondary_beacons && impl.secondary_beacons.length) {
					urls.push.apply(urls, impl.secondary_beacons);
				}


				function remove(id) {
					var el = document.getElementById(id);
					if (el) {
						el.parentNode.removeChild(el);
					}
				}

				function submit() {
					/*eslint-disable no-script-url*/
					var iframe,
					    name = "boomerang_post-" + encodeURIComponent(form.action) + "-" + Math.random();

					// ref: http://terminalapp.net/submitting-a-form-with-target-set-to-a-script-generated-iframe-on-ie/
					try {
						iframe = document.createElement('<iframe name="' + name + '">');	// IE <= 8
					}
					catch (ignore) {
						iframe = document.createElement("iframe");				// everything else
					}

					form.action = urls.shift();
					iframe.name = iframe.id = name;

					// IE Edge hangs for a minute on some sites when using form.submit().  This
					// can be avoided by not setting the form.target, and adding the form to the
					// iframe instead of the document.
					iframe.style.display = form.style.display = "none";
					iframe.src="javascript:false";

					remove(iframe.id);
					remove(form.id);

					document.body.appendChild(iframe);

					// Add the form to the iframe
					var iFrmDocument = (iframe.contentWindow || iframe.contentDocument);
					if (iFrmDocument.document) {
						iFrmDocument = iFrmDocument.document;
					}
					if (iFrmDocument.body) {
						iFrmDocument.body.appendChild(form);
					}
					else {
						//body may be null, so add to the document
						iFrmDocument.appendChild(form);
					}

					try {
						form.submit();
					}
					catch (ignore) {
						// empty
					}

					if (urls.length) {
						BOOMR.setImmediate(submit);
					}

					setTimeout(function() { remove(iframe.id); }, 10000);
				}

				submit();
			}
		},

		init: function(config) {
			var i, k,
			    properties = ["beacon_url", "beacon_type", "site_domain", "user_ip", "strip_query_string", "secondary_beacons", "autorun"];

			BOOMR_check_doc_domain();

			if (!config) {
				config = {};
			}

			if (config.primary && impl.handlers_attached) {
				return this;
			}

			if (config.log !== undefined) {
				this.log = config.log;
			}
			if (!this.log) {
				this.log = function(/* m,l,s */) {};
			}

			for (k in this.plugins) {
				if (this.plugins.hasOwnProperty(k)) {
					// config[plugin].enabled has been set to false
					if ( config[k]
						&& config[k].hasOwnProperty("enabled")
						&& config[k].enabled === false
					) {
						impl.disabled_plugins[k] = 1;

						if (typeof this.plugins[k].disable === "function") {
							this.plugins[k].disable();
						}

						continue;
					}

					// plugin was previously disabled
					if (impl.disabled_plugins[k]) {

						// and has not been explicitly re-enabled
						if ( !config[k]
							|| !config[k].hasOwnProperty("enabled")
							|| config[k].enabled !== true
						) {
							continue;
						}

						if (typeof this.plugins[k].enable === "function") {
							this.plugins[k].enable();
						}

						// plugin is now enabled
						delete impl.disabled_plugins[k];
					}

					// plugin exists and has an init method
					if (typeof this.plugins[k].init === "function") {
						try {
							this.plugins[k].init(config);
						}
						catch (err) {
							BOOMR.addError(err, k + ".init");
						}
					}
				}
			}

			for (i=0; i<properties.length; i++) {
				if (config[properties[i]] !== undefined) {
					impl[properties[i]] = config[properties[i]];
				}
			}

			if (impl.handlers_attached) {
				return this;
			}

			// The developer can override onload by setting autorun to false
			if (!impl.onloadfired && (config.autorun === undefined || config.autorun !== false)) {
				if (d.readyState && d.readyState === "complete") {
					BOOMR.loadedLate = true;
					this.setImmediate(BOOMR.page_ready_autorun, null, null, BOOMR);
				}
				else {
					if (w.onpagehide || w.onpagehide === null) {
						BOOMR.utils.addListener(w, "pageshow", BOOMR.page_ready_autorun);
					}
					else {
						BOOMR.utils.addListener(w, "load", BOOMR.page_ready_autorun);
					}
				}
			}

			BOOMR.utils.addListener(w, "DOMContentLoaded", function() { impl.fireEvent("dom_loaded"); });

			(function() {
				var forms, iterator;
				if (visibilityChange !== undefined) {
					BOOMR.utils.addListener(d, visibilityChange, function() { impl.fireEvent("visibility_changed"); });

					// record the last time each visibility state occurred
					BOOMR.subscribe("visibility_changed", function() {
						BOOMR.lastVisibilityEvent[BOOMR.visibilityState()] = BOOMR.now();
					});
				}

				BOOMR.utils.addListener(d, "mouseup", impl.xb_handler("click"));

				forms = d.getElementsByTagName("form");
				for (iterator = 0; iterator < forms.length; iterator++) {
					BOOMR.utils.addListener(forms[iterator], "submit", impl.xb_handler("form_submit"));
				}

				if (!w.onpagehide && w.onpagehide !== null) {
					// This must be the last one to fire
					// We only clear w on browsers that don't support onpagehide because
					// those that do are new enough to not have memory leak problems of
					// some older browsers
					BOOMR.utils.addListener(w, "unload", function() { BOOMR.window=w=null; });
				}
			}());

			impl.handlers_attached = true;
			return this;
		},
		/**
		 * Sends the page_ready beacon only if 'autorun' is still true after config.js
		 * arrives.
		 */
		page_ready_autorun: function(ev) {
			if (impl.autorun) {
				BOOMR.page_ready(ev);
			}
		},

		// The page dev calls this method when they determine the page is usable.
		// Only call this if autorun is explicitly set to false
		page_ready: function(ev) {
			if (!ev) { ev = w.event; }
			if (!ev) { ev = { name: "load" }; }
			if (impl.onloadfired) {
				return this;
			}
			impl.fireEvent("page_ready", ev);
			impl.onloadfired = true;
			return this;
		},

		setImmediate: function(fn, data, cb_data, cb_scope) {
			var cb, cstack;

			// DEBUG: This is to help debugging, we'll see where setImmediate calls were made from
			if (typeof Error !== "undefined") {
				cstack = new Error();
				cstack = cstack.stack ? cstack.stack.replace(/^Error/, "Called") : undefined;
			}
			// END-DEBUG

			cb = function() {
				fn.call(cb_scope || null, data, cb_data || {}, cstack);
				cb=null;
			};

			if (w.setImmediate) {
				w.setImmediate(cb);
			}
			else if (w.msSetImmediate) {
				w.msSetImmediate(cb);
			}
			else if (w.webkitSetImmediate) {
				w.webkitSetImmediate(cb);
			}
			else if (w.mozSetImmediate) {
				w.mozSetImmediate(cb);
			}
			else {
				setTimeout(cb, 10);
			}
		},

		now: (function() {
			try {
				if ("performance" in window && window.performance && window.performance.now) {
					return function() {
						return Math.round(window.performance.now() + window.performance.timing.navigationStart);
					};
				}
			}
			catch (ignore) {
				// empty
			}

			return Date.now || function() { return new Date().getTime(); };
		}()),

		visibilityState: ( visibilityState === undefined ? function() { return "visible"; } : function() { return d[visibilityState]; } ),

		lastVisibilityEvent: {},

		subscribe: function(e_name, fn, cb_data, cb_scope) {
			var i, handler, ev;

			e_name = e_name.toLowerCase();

			if (!impl.events.hasOwnProperty(e_name)) {
				return this;
			}

			ev = impl.events[e_name];

			// don't allow a handler to be attached more than once to the same event
			for (i=0; i<ev.length; i++) {
				handler = ev[i];
				if (handler && handler.fn === fn && handler.cb_data === cb_data && handler.scope === cb_scope) {
					return this;
				}
			}
			ev.push({ "fn": fn, "cb_data": cb_data || {}, "scope": cb_scope || null });

			// attaching to page_ready after onload fires, so call soon
			if (e_name === "page_ready" && impl.onloadfired) {
				this.setImmediate(fn, null, cb_data, cb_scope);
			}

			// Attach unload handlers directly to the window.onunload and
			// window.onbeforeunload events. The first of the two to fire will clear
			// fn so that the second doesn't fire. We do this because technically
			// onbeforeunload is the right event to fire, but all browsers don't
			// support it.  This allows us to fall back to onunload when onbeforeunload
			// isn't implemented
			if (e_name === "page_unload" || e_name === "before_unload") {
				(function() {
					var unload_handler, evt_idx = ev.length;

					unload_handler = function(evt) {
								if (fn) {
									fn.call(cb_scope, evt || w.event, cb_data);
								}

								// If this was the last unload handler, we'll try to send the beacon immediately after it is done
								// The beacon will only be sent if one of the handlers has queued it
								if (e_name === "page_unload" && evt_idx === impl.events[e_name].length) {
									BOOMR.real_sendBeacon();
								}
							};

					if (e_name === "page_unload") {
						// pagehide is for iOS devices
						// see http://www.webkit.org/blog/516/webkit-page-cache-ii-the-unload-event/
						if (w.onpagehide || w.onpagehide === null) {
							BOOMR.utils.addListener(w, "pagehide", unload_handler);
						}
						else {
							BOOMR.utils.addListener(w, "unload", unload_handler);
						}
					}
					BOOMR.utils.addListener(w, "beforeunload", unload_handler);
				}());
			}

			return this;
		},

		addError: function(err, src, extra) {
			var str;
			if (typeof err !== "string") {
				str = String(err);
				if (str.match(/^\[object/)) {
					str = err.name + ": " + (err.description || err.message).replace(/\r\n$/, "");
				}
				err = str;
			}
			if (src !== undefined) {
				err = "[" + src + ":" + BOOMR.now() + "] " + err;
			}
			if (extra) {
				err += ":: " + extra;
			}

			if (impl.errors[err]) {
				impl.errors[err]++;
			}
			else {
				impl.errors[err] = 1;
			}
		},

		isCrossOriginError: function(err) {
			// These are expected for cross-origin iframe access, although the Internet Explorer check will only
			// work for browsers using English.
			return err.name === "SecurityError" ||
				(err.name === "TypeError" && err.message === "Permission denied") ||
				(err.name === "Error" && err.message && err.message.match(/^(Permission|Access is) denied/));
		},

		addVar: function(name, value) {
			if (typeof name === "string") {
				impl.vars[name] = value;
			}
			else if (typeof name === "object") {
				var o = name, k;
				for (k in o) {
					if (o.hasOwnProperty(k)) {
						impl.vars[k] = o[k];
					}
				}
			}
			return this;
		},

		removeVar: function(arg0) {
			var i, params;
			if (!arguments.length) {
				return this;
			}

			if (arguments.length === 1
					&& Object.prototype.toString.apply(arg0) === "[object Array]") {
				params = arg0;
			}
			else {
				params = arguments;
			}

			for (i=0; i<params.length; i++) {
				if (impl.vars.hasOwnProperty(params[i])) {
					delete impl.vars[params[i]];
				}
			}

			return this;
		},

		hasVar: function(name) {
			return impl.vars.hasOwnProperty(name);
		},

		requestStart: function(name) {
			var t_start = BOOMR.now();
			BOOMR.plugins.RT.startTimer("xhr_" + name, t_start);

			return {
				loaded: function(data) {
					BOOMR.responseEnd(name, t_start, data);
				}
			};
		},

		responseEnd: function(name, t_start, data) {
			if (typeof name === "object" && name.url) {
				impl.fireEvent("xhr_load", name);
			}
			else {
				BOOMR.plugins.RT.startTimer("xhr_" + name, t_start);
				impl.fireEvent("xhr_load", {
					"name": "xhr_" + name,
					"data": data
				});
			}
		},

		//
		// uninstrumentXHR and instrumentXHR are stubs that will be replaced
		// by auto_xhr.js if active.
		//
		/**
		 * Undo XMLHttpRequest instrumentation and reset the original
		 */
		uninstrumentXHR: function() {
		},
		/**
		 * Instrument all requests made via XMLHttpRequest to send beacons
		 * This is implemented in plugins/auto_xhr.js
		 */
		instrumentXHR: function() { },

		sendBeacon: function(beacon_url_override) {
			// This plugin wants the beacon to go somewhere else,
			// so update the location
			if (beacon_url_override) {
				impl.beacon_url = beacon_url_override;
			}

			if (!impl.beaconQueued) {
				impl.beaconQueued = true;
				BOOMR.setImmediate(BOOMR.real_sendBeacon, null, null, BOOMR);
			}

			return true;
		},

		real_sendBeacon: function() {
			var k, form, furl, img, length=0, errors=[], url, nparams=0;

			if (!impl.beaconQueued) {
				return false;
			}

			impl.beaconQueued = false;

			BOOMR.debug("Checking if we can send beacon");

			// At this point someone is ready to send the beacon.  We send
			// the beacon only if all plugins have finished doing what they
			// wanted to do
			for (k in this.plugins) {
				if (this.plugins.hasOwnProperty(k)) {
					if (impl.disabled_plugins[k]) {
						continue;
					}
					if (!this.plugins[k].is_complete()) {
						BOOMR.debug("Plugin " + k + " is not complete, deferring beacon send");
						return false;
					}
				}
			}

			// For SPA apps, don't strip hashtags as some SPA frameworks use #s for tracking routes
			// instead of History pushState() APIs. Use d.URL instead of location.href because of a
			// Safari bug.
			var isSPA = impl.vars["http.initiator"] === "spa";
			var pgu = isSPA ? d.URL : d.URL.replace(/#.*/, "");
			impl.vars.pgu = BOOMR.utils.cleanupURL(pgu);

			// Use the current document.URL if it hasn't already been set, or for SPA apps,
			// on each new beacon (since each SPA soft navigation might change the URL)
			if (!impl.vars.u || isSPA) {
				impl.vars.u = impl.vars.pgu;
			}

			if (impl.vars.pgu === impl.vars.u) {
				delete impl.vars.pgu;
			}

			impl.vars.v = BOOMR.version;

			if (BOOMR.visibilityState()) {
				impl.vars["vis.st"] = BOOMR.visibilityState();
				if (BOOMR.lastVisibilityEvent.visible) {
					impl.vars["vis.lv"] = BOOMR.now() - BOOMR.lastVisibilityEvent.visible;
				}
				if (BOOMR.lastVisibilityEvent.hidden) {
					impl.vars["vis.lh"] = BOOMR.now() - BOOMR.lastVisibilityEvent.hidden;
				}
			}

			impl.vars["ua.plt"] = navigator.platform;
			impl.vars["ua.vnd"] = navigator.vendor;

			if (w !== window) {
				impl.vars["if"] = "";
			}

			for (k in impl.errors) {
				if (impl.errors.hasOwnProperty(k)) {
					errors.push(k + (impl.errors[k] > 1 ? " (*" + impl.errors[k] + ")" : ""));
				}
			}

			if (errors.length > 0) {
				impl.vars.errors = errors.join("\n");
			}

			impl.errors = {};

			// If we reach here, all plugins have completed
			impl.fireEvent("before_beacon", impl.vars);

			// Don't send a beacon if no beacon_url has been set
			// you would do this if you want to do some fancy beacon handling
			// in the `before_beacon` event instead of a simple GET request
			BOOMR.debug("Ready to send beacon: " + BOOMR.utils.objectToString(impl.vars));
			if (!impl.beacon_url) {
				BOOMR.debug("No beacon URL, so skipping.");
				return true;
			}

			if (!BOOMR.hasVar("restiming")) {
				// Use an Image beacon if we're not sending ResourceTiming data

				// if there are already url parameters in the beacon url,
				// change the first parameter prefix for the boomerang url parameters to &

				url = [];

				for (k in impl.vars) {
					if (impl.vars.hasOwnProperty(k)) {
						nparams++;
						url.push(encodeURIComponent(k)
							+ "="
							+ (
								impl.vars[k]===undefined || impl.vars[k]===null
								? ""
								: encodeURIComponent(impl.vars[k])
							)
						);
					}
				}

				furl = impl.beacon_url + ((impl.beacon_url.indexOf("?") > -1)?"&":"?") + url.join("&");
			}
			else {
				form = document.createElement("form");
				length = BOOMR.utils.pushVars(form, impl.vars);
			}

			// If we reach here, we've transferred all vars to the beacon URL.
			impl.fireEvent("onbeacon", impl.vars);

			if (length === 0 && nparams === 0) {
				// do not make the request if there is no data
				return this;
			}

			if (nparams) {
				img = new Image();
				img.src=furl;

				if (impl.secondary_beacons) {
					for (k = 0; k<impl.secondary_beacons.length; k++) {
						furl = impl.secondary_beacons[k] + "?" + url.join("&");
						img = new Image();
						img.src=furl;
					}
				}
			}
			else {
				// using 2000 here as a de facto maximum URL length based on:
				// http://stackoverflow.com/questions/417142/what-is-the-maximum-length-of-a-url-in-different-browsers
				BOOMR.utils.sendData(form, impl.beacon_type === "AUTO" ? (length > 2000 ? "POST" : "GET") : "POST");
			}

			return true;
		}

	};

	delete BOOMR_start;

	if (typeof BOOMR_lstart === "number") {
		boomr.t_lstart = BOOMR_lstart;
		delete BOOMR_lstart;
	}
	else if (typeof BOOMR.window.BOOMR_lstart === "number") {
		boomr.t_lstart = BOOMR.window.BOOMR_lstart;
	}

	if (typeof BOOMR.window.BOOMR_onload === "number") {
		boomr.t_onload = BOOMR.window.BOOMR_onload;
	}

	(function() {
		var make_logger;

		if (typeof console === "object" && console.log !== undefined) {
			boomr.log = function(m, l, s) { console.log(s + ": [" + l + "] " + m); };
		}

		make_logger = function(l) {
			return function(m, s) {
				this.log(m, l, "boomerang" + (s?"."+s:""));
				return this;
			};
		};

		boomr.debug = make_logger("debug");
		boomr.info = make_logger("info");
		boomr.warn = make_logger("warn");
		boomr.error = make_logger("error");
	}());


	(function() {
		var ident;
		for (ident in boomr) {
			if (boomr.hasOwnProperty(ident)) {
				BOOMR[ident] = boomr[ident];
			}
		}
		if (!BOOMR.xhr_excludes) {
			//! URLs to exclude from automatic XHR instrumentation
			BOOMR.xhr_excludes={};
		}
	}());

	dispatchEvent("onBoomerangLoaded", { "BOOMR": BOOMR }, true );

}(window));

// end of boomerang beaconing section

/**
 \file restiming.js
 Plugin to collect metrics from the W3C Resource Timing API.
 For more information about Resource Timing,
 see: http://www.w3.org/TR/resource-timing/
 */

(function () {

    var impl;

    BOOMR = BOOMR || {};
    BOOMR.plugins = BOOMR.plugins || {};
    if (BOOMR.plugins.ResourceTiming) {
      return;
    }

    var initiatorTypes = ["other", "img", "link", "script", "css", "xmlhttprequest"];


    function trimTiming(time, startTime) {
      if (typeof time !== "number") {
        time = 0;
      }

      if (typeof startTime !== "number") {
        startTime = 0;
      }

      // strip from microseconds to milliseconds only
      var timeMs = Math.round(time ? time : 0),
        startTimeMs = Math.round(startTime ? startTime : 0);

      return timeMs === 0 ? 0 : (timeMs - startTimeMs);
    }

    /**
     * Attempts to get the navigationStart time for a frame.
     * @returns navigationStart time, or 0 if not accessible
     */
    function getNavStartTime(frame) {
      var navStart = 0;

      try {
        if (("performance" in frame) &&
          frame.performance &&
          frame.performance.timing &&
          frame.performance.timing.navigationStart) {
          navStart = frame.performance.timing.navigationStart;
        }
      }
      catch (e) {
        // empty
      }

      return navStart;
    }

    /**
     * Gets all of the performance entries for a frame and its subframes
     *
     * @param [Frame] frame Frame
     * @param [boolean] top This is the top window
     * @param [string] offset Offset in timing from root IFRAME
     * @param [number] depth Recursion depth
     * @return [PerformanceEntry[]] Performance entries
     */
    function findPerformanceEntriesForFrame(frame, isTopWindow, offset, depth) {
      var entries = [], i, navEntries, navStart, frameNavStart, frameOffset, navEntry, t;

      if (typeof isTopWindow === "undefined") {
        isTopWindow = true;
      }

      if (typeof offset === "undefined") {
        offset = 0;
      }

      if (typeof depth === "undefined") {
        depth = 0;
      }

      if (depth > 10) {
        return entries;
      }

      navStart = getNavStartTime(frame);

      // get sub-frames' entries first
      if (frame.frames) {
        for (i = 0; i < frame.frames.length; i++) {
          frameNavStart = getNavStartTime(frame.frames[i]);
          frameOffset = 0;
          if (frameNavStart > navStart) {
            frameOffset = offset + (frameNavStart - navStart);
          }

          entries = entries.concat(findPerformanceEntriesForFrame(frame.frames[i], false, frameOffset, depth + 1));
        }
      }

      try {
        if (!("performance" in frame) || !frame.performance ||
          typeof frame.performance.getEntriesByType !== "function") {
          return entries;
        }

        // add an entry for the top page
        if (isTopWindow) {
          navEntries = frame.performance.getEntriesByType("navigation");
          if (navEntries && navEntries.length === 1) {
            navEntry = navEntries[0];

            // replace document with the actual URL
            entries.push({
              name: frame.location.href,
              startTime: 0,
              redirectStart: navEntry.redirectStart,
              redirectEnd: navEntry.redirectEnd,
              fetchStart: navEntry.fetchStart,
              domainLookupStart: navEntry.domainLookupStart,
              domainLookupEnd: navEntry.domainLookupEnd,
              connectStart: navEntry.connectStart,
              secureConnectionStart: navEntry.secureConnectionStart,
              connectEnd: navEntry.connectEnd,
              requestStart: navEntry.requestStart,
              responseStart: navEntry.responseStart,
              responseEnd: navEntry.responseEnd
            });
          }
          else if (frame.performance.timing) {
            // add a fake entry from the timing object
            t = frame.performance.timing;
            entries.push({
              name: frame.location.href,
              startTime: 0,
              redirectStart: t.redirectStart ? (t.redirectStart - t.navigationStart) : 0,
              redirectEnd: t.redirectEnd ? (t.redirectEnd - t.navigationStart) : 0,
              fetchStart: t.fetchStart ? (t.fetchStart - t.navigationStart) : 0,
              domainLookupStart: t.domainLookupStart ? (t.domainLookupStart - t.navigationStart) : 0,
              domainLookupEnd: t.domainLookupEnd ? (t.domainLookupEnd - t.navigationStart) : 0,
              connectStart: t.connectStart ? (t.connectStart - t.navigationStart) : 0,
              secureConnectionStart: t.secureConnectionStart ? (t.secureConnectionStart - t.navigationStart) : 0,
              connectEnd: t.connectEnd ? (t.connectEnd - t.navigationStart) : 0,
              requestStart: t.requestStart ? (t.requestStart - t.navigationStart) : 0,
              responseStart: t.responseStart ? (t.responseStart - t.navigationStart) : 0,
              responseEnd: t.responseEnd ? (t.responseEnd - t.navigationStart) : 0
            });
          }
        }

        // offset all of the entries by the specified offset for this frame
        var frameEntries = frame.performance.getEntriesByType("resource"),
          frameFixedEntries = [];

        for (i = 0; frameEntries && i < frameEntries.length; i++) {
          t = frameEntries[i];
          frameFixedEntries.push({
            name: t.name,
            initiatorType: t.initiatorType,
            startTime: t.startTime + offset,
            redirectStart: t.redirectStart ? (t.redirectStart + offset) : 0,
            redirectEnd: t.redirectEnd ? (t.redirectEnd + offset) : 0,
            fetchStart: t.fetchStart ? (t.fetchStart + offset) : 0,
            domainLookupStart: t.domainLookupStart ? (t.domainLookupStart + offset) : 0,
            domainLookupEnd: t.domainLookupEnd ? (t.domainLookupEnd + offset) : 0,
            connectStart: t.connectStart ? (t.connectStart + offset) : 0,
            secureConnectionStart: t.secureConnectionStart ? (t.secureConnectionStart + offset) : 0,
            connectEnd: t.connectEnd ? (t.connectEnd + offset) : 0,
            requestStart: t.requestStart ? (t.requestStart + offset) : 0,
            responseStart: t.responseStart ? (t.responseStart + offset) : 0,
            responseEnd: t.responseEnd ? (t.responseEnd + offset) : 0
          });
        }

        entries = entries.concat(frameFixedEntries);
      }
      catch (e) {
        return entries;
      }

      return entries;
    }


    /**
     * Gathers performance entries and optimizes the result.
     * @param [number] since Only get timings since
     * @return Optimized performance entries trie
     */
    function getResourceTiming(since) {
      /*eslint no-script-url:0*/
      var entries = findPerformanceEntriesForFrame(BOOMR.window, true, 0, 0),
        i, e, results = {}, initiatorType,
        navStart = getNavStartTime(BOOMR.window);

      if (!entries || !entries.length) {
        return {};
      }

      for (i = 0; i < entries.length; i++) {
        e = entries[i];

        if (e.name.indexOf("about:") === 0 ||
          e.name.indexOf("javascript:") === 0) {
          continue;
        }

        if (e.name.indexOf(BOOMR.url) > -1 ||
          e.name.indexOf(BOOMR.config_url) > -1) {
          continue;
        }

        if (since && (navStart + e.startTime) < since) {
          continue;
        }

        //
        // Compress the RT data into a string:
        //
        // 1. Start with the initiator type, which is mapped to a number.
        // 2. Put the timestamps into an array in a set order (reverse chronological order),
        //    which pushes timestamps that are more likely to be zero (duration since
        //    startTime) towards the end of the array (eg redirect* and domainLookup*).
        // 3. Convert these timestamps to Base36, with empty or zero times being an empty string
        // 4. Join the array on commas
        // 5. Trim all trailing empty commas (eg ",,,")
        //

        // prefix initiatorType to the string
        initiatorType = e.initiatorType;
        if (typeof initiatorType === "undefined") {
          initiatorType = "other";
        }


        var entry = {};
        entry.url = BOOMR.utils.cleanupURL(e.name);;
        entry.t_done = trimTiming(e.responseEnd, e.startTime);
        entry.start_at = trimTiming(e.startTime, 0);

        // if this entry already exists, add a pipe as a separator
        if (results[initiatorType] === undefined) {
          results[initiatorType] = {};
          results[initiatorType].nb = 0;
          results[initiatorType].ordered_items = [];
          results[initiatorType].t_cumulated = 0;
        }
        results[initiatorType].nb++;
        results[initiatorType].t_cumulated += entry.t_done;
        results[initiatorType].ordered_items.push(entry);
      }

      // final sort
      for (var i = 0; i < initiatorTypes.length; i++) {
        if (results[initiatorTypes[i]] !== undefined) {
          results[initiatorTypes[i]].ordered_items.sort(function (e1, e2) {
              return e2.t_done - e1.t_done;
            }
          )
        }
      }

      return results;
    }

    impl = {
      complete: false,
      initialized: false,
      supported: false,
      xhr_load: function () {
        if (this.complete) {
          return;
        }

        // page load might not have happened, or will happen later, so
        // set us as complete so we don't hold the page load
        this.complete = true;
        BOOMR.sendBeacon();
      },
      done: function () {
        var r;
        if (this.complete) {
          return;
        }
        BOOMR.removeVar("restiming");
        r = getResourceTiming();
        if (r) {
          BOOMR.info("Client supports Resource Timing API", "restiming");
          BOOMR.addVar({
            restiming: JSON.stringify(r)
          });
        }
        this.complete = true;
        BOOMR.sendBeacon();
      },

      clearMetrics: function (vars) {
        if (vars.hasOwnProperty("restiming")) {
          BOOMR.removeVar("restiming");
        }
      }
    };

    BOOMR.plugins.ResourceTiming = {
      init: function (config) {
        var p = BOOMR.window.performance;

        BOOMR.utils.pluginConfig(impl, config, "ResourceTiming", []);

        if (impl.initialized) {
          return this;
        }

        if (p && typeof p.getEntriesByType === "function") {
          BOOMR.subscribe("page_ready", impl.done, null, impl);
          BOOMR.subscribe("xhr_load", impl.xhr_load, null, impl);
          BOOMR.subscribe("onbeacon", impl.clearMetrics, null, impl);
          BOOMR.subscribe("before_unload", impl.done, null, impl);
          impl.supported = true;
        }
        else {
          impl.complete = true;
        }

        impl.initialized = true;

        return this;
      },
      is_complete: function () {
        return true;
      },
      is_supported: function () {
        return impl.initialized && impl.supported;
      },
      // exports for test
      trimTiming: trimTiming,
      findPerformanceEntriesForFrame: findPerformanceEntriesForFrame,
      getResourceTiming: getResourceTiming,
    };

  }

  ()
);

/*
 * Copyright (c) 2011, Yahoo! Inc.  All rights reserved.
 * Copyright (c) 2012, Log-Normal, Inc.  All rights reserved.
 * Copyrights licensed under the BSD License. See the accompanying LICENSE.txt file for terms.
 */

// This is the Round Trip Time plugin.  Abbreviated to RT
// the parameter is the window
(function(w) {

/*eslint no-underscore-dangle:0*/

	var d=w.document, impl;

	BOOMR = BOOMR || {};
	BOOMR.plugins = BOOMR.plugins || {};
	if (BOOMR.plugins.RT) {
		return;
	}

	// private object
	impl = {
		onloadfired: false,	//! Set when the page_ready event fires
					//  Use this to determine if unload fires before onload
		unloadfired: false,	//! Set when the first unload event fires
					//  Use this to make sure we don't beacon twice for beforeunload and unload
		visiblefired: false,	//! Set when page becomes visible (Chrome/IE)
					//  Use this to determine if user bailed without opening the tab
		initialized: false,	//! Set when init has completed to prevent double initialization
		complete: false,	//! Set when this plugin has completed

		timers: {},		//! Custom timers that the developer can use
					// Format for each timer is { start: XXX, end: YYY, delta: YYY-XXX }
		cookie: "RT",		//! Name of the cookie that stores the start time and referrer
		cookie_exp: 600,	//! Cookie expiry in seconds
		strict_referrer: true,	//! By default, don't beacon if referrers don't match.
					// If set to false, beacon both referrer values and let
					// the back end decide

		navigationType: 0,	// Navigation Type from the NavTiming API.  We mainly care if this was BACK_FORWARD
					// since cookie time will be incorrect in that case
		navigationStart: undefined,
		responseStart: undefined,
		t_start: undefined,	// t_start that came off the cookie
		cached_t_start: undefined,	// cached value of t_start once we know its real value
		t_fb_approx: undefined,	// approximate first byte time for browsers that don't support navtiming
		r: undefined,		// referrer from the cookie
		r2: undefined,		// referrer from document.referer

		// These timers are added directly as beacon variables
		basic_timers: { t_done: 1, t_resp: 1, t_page: 1},

		// Vars that were added to the beacon that we can remove after beaconing
		addedVars: [],

		/**
		 * Merge new cookie `params` onto current cookie, and set `timer` param on cookie to current timestamp
		 * @param params object containing keys & values to merge onto current cookie.  A value of `undefined`
		 *		 will remove the key from the cookie
		 * @param timer  string key name that will be set to the current timestamp on the cookie
		 *
		 * @returns true if the cookie was updated, false if the cookie could not be set for any reason
		 */
		updateCookie: function(params, timer) {
			var t_end, t_start, subcookies, k;

			// Disable use of RT cookie by setting its name to a falsy value
			if (!this.cookie) {
				return false;
			}

			subcookies = BOOMR.utils.getSubCookies(BOOMR.utils.getCookie(this.cookie)) || {};

			if (typeof params === "object") {
				for (k in params) {
					if (params.hasOwnProperty(k)) {
						if (params[k] === undefined ) {
							if (subcookies.hasOwnProperty(k)) {
								delete subcookies[k];
							}
						}
						else {
							if (k==="nu" || k==="r") {
								params[k] = BOOMR.utils.hashQueryString(params[k], true);
							}

							subcookies[k] = params[k];
						}
					}
				}
			}

			t_start = BOOMR.now();

			if (timer) {
				subcookies[timer] = t_start;
			}

			BOOMR.debug("Setting cookie (timer=" + timer + ")\n" + BOOMR.utils.objectToString(subcookies), "rt");
			if (!BOOMR.utils.setCookie(this.cookie, subcookies, this.cookie_exp)) {
				BOOMR.error("cannot set start cookie", "rt");
				return false;
			}

			t_end = BOOMR.now();
			if (t_end - t_start > 50) {
				// It took > 50ms to set the cookie
				// The user Most likely has cookie prompting turned on so
				// t_start won't be the actual unload time
				// We bail at this point since we can't reliably tell t_done
				BOOMR.utils.removeCookie(this.cookie);

				// at some point we may want to log this info on the server side
				BOOMR.error("took more than 50ms to set cookie... aborting: "
						+ t_start + " -> " + t_end, "rt");
			}

			return true;
		},

		/**
		 * Read initial values from cookie and clear out cookie values it cares about after reading.
		 * This makes sure that other pages (eg: loaded in new tabs) do not get an invalid cookie time.
		 * This method should only be called from init, and may be called more than once.
		 *
		 * Request start time is the greater of last page beforeunload or last click time
		 * If start time came from a click, we check that the clicked URL matches the current URL
		 * If it came from a beforeunload, we check that cookie referrer matches document.referrer
		 *
		 * If we had a pageHide time or unload time, we use that as a proxy for first byte on non-navtiming
		 * browsers.
		 */
		initFromCookie: function() {
			var url, subcookies;
			subcookies = BOOMR.utils.getSubCookies(BOOMR.utils.getCookie(this.cookie));

			if (!subcookies) {
				return;
			}

			subcookies.s = Math.max(+subcookies.ld||0, Math.max(+subcookies.ul||0, +subcookies.cl||0));

			BOOMR.debug("Read from cookie " + BOOMR.utils.objectToString(subcookies), "rt");

			// If we have a start time, and either a referrer, or a clicked on URL,
			// we check if the start time is usable
			if (subcookies.s && (subcookies.r || subcookies.nu)) {
				this.r = subcookies.r;
				url = BOOMR.utils.hashQueryString(d.URL, true);

				// Either the URL of the page setting the cookie needs to match document.referrer
				BOOMR.debug(this.r + " =?= " + this.r2, "rt");

				// Or the start timer was no more than 15ms after a click or form submit
				// and the URL clicked or submitted to matches the current page's URL
				// (note the start timer may be later than click if both click and beforeunload fired
				// on the previous page)
				BOOMR.debug(subcookies.s + " <? " + (+subcookies.cl+15), "rt");
				BOOMR.debug(subcookies.nu + " =?= " + url, "rt");

				if (!this.strict_referrer ||
					(subcookies.nu && subcookies.nu === url && subcookies.s < +subcookies.cl + 15) ||
					(subcookies.s === +subcookies.ul && this.r === this.r2)
				) {
					this.t_start = subcookies.s;

					// additionally, if we have a pagehide, or unload event, that's a proxy
					// for the first byte of the current page, so use that wisely
					if (+subcookies.hd > subcookies.s) {
						this.t_fb_approx = parseInt(subcookies.hd, 10);
					}
				}
				else {
					this.t_start = this.t_fb_approx = undefined;
				}
			}

			// Now that we've pulled out the timers, we'll clear them so they don't pollute future calls
			this.updateCookie({
				s: undefined,	// start timer
				r: undefined,	// referrer
				nu: undefined,	// clicked url
				ul: undefined,	// onbeforeunload time
				cl: undefined,	// onclick time
				hd: undefined	// onunload or onpagehide time
			});
		},

		/**
		 * Figure out how long boomerang and config.js took to load using resource timing if available, or built in timestamps
		 */
		getBoomerangTimings: function() {
			var res, urls, url, startTime, data;

			function trimTiming(time, st) {
				// strip from microseconds to milliseconds only
				var timeMs = Math.round(time ? time : 0),
				    startTimeMs = Math.round(st ? st : 0);

				timeMs = (timeMs === 0 ? 0 : (timeMs - startTimeMs));

				return timeMs ? timeMs : "";
			}

			if (BOOMR.t_start) {
				// How long does it take Boomerang to load up and execute (fb to lb)?
				BOOMR.plugins.RT.startTimer("boomerang", BOOMR.t_start);
				BOOMR.plugins.RT.endTimer("boomerang", BOOMR.t_end);	// t_end === null defaults to current time

				// How long did it take from page request to boomerang fb?
				BOOMR.plugins.RT.endTimer("boomr_fb", BOOMR.t_start);

				if (BOOMR.t_lstart) {
					// when did the boomerang loader start loading boomerang on the page?
					BOOMR.plugins.RT.endTimer("boomr_ld", BOOMR.t_lstart);
					// What was the network latency for boomerang (request to first byte)?
					BOOMR.plugins.RT.setTimer("boomr_lat", BOOMR.t_start - BOOMR.t_lstart);
				}
			}

			// use window and not w because we want the inner iframe
			try {
				if (window.performance && window.performance.getEntriesByName) {
					urls = { "rt.bmr": BOOMR.url };

					for (url in urls) {
						if (urls.hasOwnProperty(url) && urls[url]) {
							res = window.performance.getEntriesByName(urls[url]);
							if (!res || res.length === 0) {
								continue;
							}
							res = res[0];

							startTime = trimTiming(res.startTime, 0);
							data = [
								startTime,
								trimTiming(res.responseEnd, startTime),
								trimTiming(res.responseStart, startTime),
								trimTiming(res.requestStart, startTime),
								trimTiming(res.connectEnd, startTime),
								trimTiming(res.secureConnectionStart, startTime),
								trimTiming(res.connectStart, startTime),
								trimTiming(res.domainLookupEnd, startTime),
								trimTiming(res.domainLookupStart, startTime),
								trimTiming(res.redirectEnd, startTime),
								trimTiming(res.redirectStart, startTime)
							].join(",").replace(/,+$/, "");

							BOOMR.addVar(url, data);
							impl.addedVars.push(url);
						}
					}
				}
			}
			catch(e) {
				BOOMR.addError(e, "rt.getBoomerangTimings");
			}
		},

		/**
		 * Check if we're in a prerender state, and if we are, set additional timers.
		 * In Chrome/IE, a prerender state is when a page is completely rendered in an in-memory buffer, before
		 * a user requests that page.  We do not beacon at this point because the user has not shown intent
		 * to view the page.  If the user opens the page, the visibility state changes to visible, and we
		 * fire the beacon at that point, including any timing details for prerendering.
		 *
		 * Sets the `t_load` timer to the actual value of page load time (request initiated by browser to onload)
		 *
		 * @returns true if this is a prerender state, false if not (or not supported)
		 */
		checkPreRender: function() {
			if (BOOMR.visibilityState() !== "prerender") {
				return false;
			}

			// This means that onload fired through a pre-render.  We'll capture this
			// time, but wait for t_done until after the page has become either visible
			// or hidden (ie, it moved out of the pre-render state)
			// http://code.google.com/chrome/whitepapers/pagevisibility.html
			// http://www.w3.org/TR/2011/WD-page-visibility-20110602/
			// http://code.google.com/chrome/whitepapers/prerender.html

			BOOMR.plugins.RT.startTimer("t_load", this.navigationStart);
			BOOMR.plugins.RT.endTimer("t_load");					// this will measure actual onload time for a prerendered page
			BOOMR.plugins.RT.startTimer("t_prerender", this.navigationStart);
			BOOMR.plugins.RT.startTimer("t_postrender");				// time from prerender to visible or hidden

			return true;
		},

		/**
		 * Initialise timers from the NavigationTiming API.  This method looks at various sources for
		 * Navigation Timing, and also patches around bugs in various browser implementations.
		 * It sets the beacon parameter `rt.start` to the source of the timer
		 */
		initFromNavTiming: function() {
			var ti, p, source;

			if (this.navigationStart) {
				return;
			}

			// Get start time from WebTiming API see:
			// https://dvcs.w3.org/hg/webperf/raw-file/tip/specs/NavigationTiming/Overview.html
			// http://blogs.msdn.com/b/ie/archive/2010/06/28/measuring-web-page-performance.aspx
			// http://blog.chromium.org/2010/07/do-you-know-how-slow-your-web-page-is.html
			p = w.performance || w.msPerformance || w.webkitPerformance || w.mozPerformance;

			if (p && p.navigation) {
				this.navigationType = p.navigation.type;
			}

			if (p && p.timing) {
				ti = p.timing;
			}
			else if (w.chrome && w.chrome.csi && w.chrome.csi().startE) {
				// Older versions of chrome also have a timing API that's sort of documented here:
				// http://ecmanaut.blogspot.com/2010/06/google-bom-feature-ms-since-pageload.html
				// source here:
				// http://src.chromium.org/viewvc/chrome/trunk/src/chrome/renderer/loadtimes_extension_bindings.cc?view=markup
				ti = {
					navigationStart: w.chrome.csi().startE
				};
				source = "csi";
			}
			else if (w.gtbExternal && w.gtbExternal.startE()) {
				// The Google Toolbar exposes navigation start time similar to old versions of chrome
				// This would work for any browser that has the google toolbar installed
				ti = {
					navigationStart: w.gtbExternal.startE()
				};
				source = "gtb";
			}

			if (ti) {
				// Always use navigationStart since it falls back to fetchStart (not with redirects)
				// If not set, we leave t_start alone so that timers that depend
				// on it don't get sent back.  Never use requestStart since if
				// the first request fails and the browser retries, it will contain
				// the value for the new request.
				BOOMR.addVar("rt.start", source || "navigation");
				this.navigationStart = ti.navigationStart || ti.fetchStart || undefined;
				this.responseStart = ti.responseStart || undefined;

				// bug in Firefox 7 & 8 https://bugzilla.mozilla.org/show_bug.cgi?id=691547
				if (navigator.userAgent.match(/Firefox\/[78]\./)) {
					this.navigationStart = ti.unloadEventStart || ti.fetchStart || undefined;
				}
			}
			else {
				BOOMR.warn("This browser doesn't support the WebTiming API", "rt");
			}

			return;
		},

		/**
		 * Validate that the time we think is the load time is correct.  This can be wrong if boomerang was loaded
		 * after onload, so in that case, if navigation timing is available, we use that instead.
		 */
		validateLoadTimestamp: function(t_now, data, ename) {


			// beacon with detailed timing information
			if (data && data.timing && data.timing.loadEventEnd) {
				return data.timing.loadEventEnd;
			}
			else if (ename === "xhr" && (!data || data.initiator !== "spa")) {
				// if this is an XHR event, trust the input end "now" timestamp
				return t_now;
			}
			// Boomerang loaded late and...
			else if (BOOMR.loadedLate) {
				// We have navigation timing,
				if (w.performance && w.performance.timing) {
					// and boomerang loaded after onload fired
					if (w.performance.timing.loadEventStart && w.performance.timing.loadEventStart < BOOMR.t_end) {
						return w.performance.timing.loadEventStart;
					}
				}
				// We don't have navigation timing,
				else {
					// So we'll just use the time when boomerang was added to the page
					// Assuming that this means boomerang was added in onload.  If we logged the
					// onload timestamp (via loader snippet), use that first.
					return BOOMR.t_onload || BOOMR.t_lstart || BOOMR.t_start || t_now;
				}
			}

			// default to now
			return t_now;
		},

		/**
		 * Set timers appropriate at page load time.  This method should be called from done() only when
		 * the page_ready event fires.  It sets the following timer values:
		 *		- t_resp:	time from request start to first byte
		 *		- t_page:	time from first byte to load
		 *		- t_postrender	time from prerender state to visible state
		 *		- t_prerender	time from navigation start to visible state
		 *
		 * @param ename  The Event name that initiated this control flow
		 * @param t_done The timestamp when the done() method was called
		 * @param data   Event data passed in from the caller.  For xhr beacons, this may contain detailed timing information
		 *
		 * @returns true if timers were set, false if we're in a prerender state, caller should abort on false.
		 */
		setPageLoadTimers: function(ename, t_done, data) {
			var t_resp_start;

			if (ename !== "xhr") {
				impl.initFromCookie();
				impl.initFromNavTiming();

				if (impl.checkPreRender()) {
					return false;
				}
			}

			if (ename === "xhr") {
				if (data && data.timing) {
					// Use details from xhr object to figure out resp latency and page time
					// t_resp will use the cookie if available or fallback to NavTiming
					t_resp_start = data.timing.responseStart;
				}
			}
			else if (impl.responseStart) {
				// Use NavTiming API to figure out resp latency and page time
				// t_resp will use the cookie if available or fallback to NavTiming
				t_resp_start = impl.responseStart;
			}
			else if (impl.timers.hasOwnProperty("t_page")) {
				// If the dev has already started t_page timer, we can end it now as well
				BOOMR.plugins.RT.endTimer("t_page");
			}
			else if (impl.t_fb_approx) {
				// If we have an approximate first byte time from the cookie, use it
				t_resp_start = impl.t_fb_approx;
			}

			if (t_resp_start) {
				BOOMR.plugins.RT.endTimer("t_resp", t_resp_start);

				if (impl.timers.t_load) {	// t_load is the actual time load completed if using prerender
					BOOMR.plugins.RT.setTimer("t_page", impl.timers.t_load.end - t_resp_start);
				}
				else {
					BOOMR.plugins.RT.setTimer("t_page", t_done - t_resp_start);
				}
			}

			// If a prerender timer was started, we can end it now as well
			if (impl.timers.hasOwnProperty("t_postrender")) {
				BOOMR.plugins.RT.endTimer("t_postrender");
				BOOMR.plugins.RT.endTimer("t_prerender");
			}

			return true;
		},

		/**
		 * Writes a bunch of timestamps onto the beacon that help in request tracing on the server
		 * 	- rt.tstart: The value of t_start that we determined was appropriate
		 *	- rt.cstart: The value of t_start from the cookie if different from rt.tstart
		 *	- rt.bstart: The timestamp when boomerang started
		 *	- rt.blstart:The timestamp when boomerang was added to the host page
		 *	- rt.end:    The timestamp when the t_done timer ended
		 *
		 * @param t_start The value of t_start that we plan to use
		 */
		setSupportingTimestamps: function(t_start) {
			if (t_start) {
				BOOMR.addVar("rt.tstart", t_start);
			}
			if (typeof impl.t_start === "number" && impl.t_start !== t_start) {
				BOOMR.addVar("rt.cstart", impl.t_start);
			}
			BOOMR.addVar("rt.bstart", BOOMR.t_start);
			if (BOOMR.t_lstart) {
				BOOMR.addVar("rt.blstart", BOOMR.t_lstart);
			}
			BOOMR.addVar("rt.end", impl.timers.t_done.end);	// don't just use t_done because dev may have called endTimer before we did
		},

		/**
		 * Determines the best value to use for t_start.
		 * If called from an xhr call, then use the start time for that call
		 * Else, If we have navigation timing, use that
		 * Else, If we have a cookie time, and this isn't the result of a BACK button, use the cookie time
		 * Else, if we have a cached timestamp from an earlier call, use that
		 * Else, give up
		 *
		 * @param ename	The event name that resulted in this call. Special consideration for "xhr"
		 * @param data  Data passed in from the event caller. If the event name is "xhr",
		 *              this should contain the page group name for the xhr call in an attribute called `name`
		 *		and optionally, detailed timing information in a sub-object called `timing`
		 *              and resource information in a sub-object called `resource`
		 *
		 * @returns the determined value of t_start or undefined if unknown
		 */
		determineTStart: function(ename, data) {
			var t_start;
			if (ename==="xhr") {
				if (data && data.name && impl.timers[data.name]) {
					// For xhr timers, t_start is stored in impl.timers.xhr_{page group name}
					t_start = impl.timers[data.name].start;
				}
				else if (data && data.timing && data.timing.requestStart) {
					// For automatically instrumented xhr timers, we have detailed timing information
					t_start = data.timing.requestStart;
				}
				if (typeof t_start === "undefined" && data && data.initiator === "spa") {
					// if we don't have a start time, set to none so it can possibly be fixed up
					BOOMR.addVar("rt.start", "none");
				}
				else {
					BOOMR.addVar("rt.start", "manual");
				}
			}
			else if (impl.navigationStart) {
				t_start = impl.navigationStart;
			}
			else if (impl.t_start && impl.navigationType !== 2) {
				t_start = impl.t_start;			// 2 is TYPE_BACK_FORWARD but the constant may not be defined across browsers
				BOOMR.addVar("rt.start", "cookie");	// if the user hit the back button, referrer will match, and cookie will match
			}						// but will have time of previous page start, so t_done will be wrong
			else if (impl.cached_t_start) {
				t_start = impl.cached_t_start;
			}
			else {
				BOOMR.addVar("rt.start", "none");
				t_start = undefined;			// force all timers to NaN state
			}

			BOOMR.debug("Got start time: " + t_start, "rt");
			impl.cached_t_start = t_start;

			return t_start;
		},

		page_ready: function() {
			// we need onloadfired because it's possible to reset "impl.complete"
			// if you're measuring multiple xhr loads, but not possible to reset
			// impl.onloadfired
			this.onloadfired = true;
		},

		check_visibility: function() {
			// we care if the page became visible at some point
			if (BOOMR.visibilityState() === "visible") {
				impl.visiblefired = true;
			}

			if (impl.visibilityState === "prerender" && BOOMR.visibilityState() !== "prerender") {
				BOOMR.plugins.RT.done(null, "visible");
			}

			impl.visibilityState = BOOMR.visibilityState();
		},

		page_unload: function(edata) {
			BOOMR.debug("Unload called with " + BOOMR.utils.objectToString(edata) + " when unloadfired = " + this.unloadfired, "rt");
			if (!this.unloadfired) {
				// run done on abort or on page_unload to measure session length
				BOOMR.plugins.RT.done(edata, "unload");
			}

			// set cookie for next page
			// We use document.URL instead of location.href because of a bug in safari 4
			// where location.href is URL decoded
			this.updateCookie({ "r": d.URL }, edata.type === "beforeunload"?"ul":"hd");

			this.unloadfired = true;
		},

		_iterable_click: function(name, element, etarget, value_cb) {
			var value;
			if (!etarget) {
				return;
			}
			BOOMR.debug(name + " called with " + etarget.nodeName, "rt");
			while (etarget && etarget.nodeName.toUpperCase() !== element) {
				etarget = etarget.parentNode;
			}
			if (etarget && etarget.nodeName.toUpperCase() === element) {
				BOOMR.debug("passing through", "rt");

				// user event, they may be going to another page
				// if this page is being opened in a different tab, then
				// our unload handler won't fire, so we need to set our
				// cookie on click or submit
				value = value_cb(etarget);
				this.updateCookie({ "nu": value }, "cl" );
				BOOMR.addVar("nu", BOOMR.utils.cleanupURL(value));
				impl.addedVars.push("nu");
			}
		},

		onclick: function(etarget) {
			impl._iterable_click("Click", "A", etarget, function(t) { return t.href; });
		},

		onsubmit: function(etarget) {
			impl._iterable_click("Submit", "FORM", etarget, function(t) {
				var v = t.getAttribute("action") || d.URL || "";
				return v.match(/\?/) ? v : v + "?";
			});
		},

		domloaded: function() {
			BOOMR.plugins.RT.endTimer("t_domloaded");
		},

		clear: function() {
			if (impl.addedVars && impl.addedVars.length > 0) {
				BOOMR.removeVar(impl.addedVars);
				impl.addedVars = [];
			}
		}
	};

	BOOMR.plugins.RT = {
		// Methods

		init: function(config) {
			BOOMR.debug("init RT", "rt");
			if (w !== BOOMR.window) {
				w = BOOMR.window;
			}
			d = w.document;

			BOOMR.utils.pluginConfig(impl, config, "RT",
						["cookie", "cookie_exp", "strict_referrer"]);

			// A beacon may be fired automatically on page load or if the page dev fires
			// it manually with their own timers.  It may not always contain a referrer
			// (eg: XHR calls).  We set default values for these cases.
			// This is done before reading from the cookie because the cookie overwrites
			// impl.r
			impl.r = impl.r2 = BOOMR.utils.hashQueryString(d.referrer, true);

			// Now pull out start time information from the cookie
			// We'll do this every time init is called, and every time we call it, it will
			// overwrite values already set (provided there are values to read out)
			impl.initFromCookie();

			// We'll get BoomerangTimings every time init is called because it could also
			// include additional timers which might happen on a subsequent init call.
			impl.getBoomerangTimings();

			// only initialize once.  we still collect config and check/set cookies
			// every time init is called, but we attach event handlers only once
			if (impl.initialized) {
				return this;
			}

			impl.complete = false;
			impl.timers = {};

			impl.check_visibility();

			BOOMR.subscribe("page_ready", impl.page_ready, null, impl);
			BOOMR.subscribe("visibility_changed", impl.check_visibility, null, impl);
			BOOMR.subscribe("page_ready", this.done, "load", this);
			BOOMR.subscribe("xhr_load", this.done, "xhr", this);
			BOOMR.subscribe("dom_loaded", impl.domloaded, null, impl);
			BOOMR.subscribe("page_unload", impl.page_unload, null, impl);
			BOOMR.subscribe("click", impl.onclick, null, impl);
			BOOMR.subscribe("form_submit", impl.onsubmit, null, impl);
			BOOMR.subscribe("before_beacon", this.addTimersToBeacon, "beacon", this);
			BOOMR.subscribe("onbeacon", impl.clear, null, impl);

			impl.initialized = true;
			return this;
		},

		startTimer: function(timer_name, time_value) {
			if (timer_name) {
				if (timer_name === "t_page") {
					this.endTimer("t_resp", time_value);
				}
				impl.timers[timer_name] = {start: (typeof time_value === "number" ? time_value : BOOMR.now())};
			}

			return this;
		},

		endTimer: function(timer_name, time_value) {
			if (timer_name) {
				impl.timers[timer_name] = impl.timers[timer_name] || {};
				if (impl.timers[timer_name].end === undefined) {
					impl.timers[timer_name].end =
							(typeof time_value === "number" ? time_value : BOOMR.now());
				}
			}

			return this;
		},

		setTimer: function(timer_name, time_delta) {
			if (timer_name) {
				impl.timers[timer_name] = { delta: time_delta };
			}

			return this;
		},

		addTimersToBeacon: function(vars, source) {
			var t_name, timer,
			    t_other=[];

			for (t_name in impl.timers) {
				if (impl.timers.hasOwnProperty(t_name)) {
					timer = impl.timers[t_name];

					// if delta is a number, then it was set using setTimer
					// if not, then we have to calculate it using start & end
					if (typeof timer.delta !== "number") {
						if (typeof timer.start !== "number") {
							timer.start = impl.cached_t_start;
						}
						timer.delta = timer.end - timer.start;
					}

					// If the caller did not set a start time, and if there was no start cookie
					// Or if there was no end time for this timer,
					// then timer.delta will be NaN, in which case we discard it.
					if (isNaN(timer.delta)) {
						continue;
					}

					if (impl.basic_timers.hasOwnProperty(t_name)) {
						BOOMR.addVar(t_name, timer.delta);
						impl.addedVars.push(t_name);
					}
					else {
						t_other.push(t_name + "|" + timer.delta);
					}
				}
			}

			if (t_other.length) {
				BOOMR.addVar("t_other", t_other.join(","));
				impl.addedVars.push("t_other");
			}

			if (source === "beacon") {
				impl.timers = {};
				impl.complete = false;	// reset this state for the next call
			}
		},

		// Called when the page has reached a "usable" state.  This may be when the
		// onload event fires, or it could be at some other moment during/after page
		// load when the page is usable by the user
		done: function(edata, ename) {
			// try/catch just in case edata contains cross-origin data and objectToString throws a security exception
			try {
				BOOMR.debug("Called done with " + BOOMR.utils.objectToString(edata, undefined, 1) + ", " + ename, "rt");
			}
			catch(err) {
				BOOMR.debug("Called done with " + err + ", " + ename, "rt");
			}
			var t_start, t_done, t_now=BOOMR.now(),
			    subresource = false;

			// We may have to rerun if this was a pre-rendered page, so set complete to false, and only set to true when we're done
			impl.complete = false;

			t_done = impl.validateLoadTimestamp(t_now, edata, ename);

			if (ename==="load" || ename==="visible" || ename==="xhr") {
				if (!impl.setPageLoadTimers(ename, t_done, edata)) {
					return this;
				}
			}

			t_start = impl.determineTStart(ename, edata);

			// If the dev has already called endTimer, then this call will do nothing
			// else, it will stop the page load timer
			this.endTimer("t_done", t_done);

			// make sure old variables don't stick around
			BOOMR.removeVar(
				"t_done", "t_page", "t_resp", "t_postrender", "t_prerender", "t_load", "t_other",
				"r", "r2", "rt.tstart", "rt.cstart", "rt.bstart", "rt.end", "rt.subres", "rt.abld",
				"http.errno", "http.method", "xhr.sync"
			);

			impl.setSupportingTimestamps(t_start);

			this.addTimersToBeacon();

			BOOMR.addVar("r", BOOMR.utils.cleanupURL(impl.r));

			if (impl.r2 !== impl.r) {
				BOOMR.addVar("r2", BOOMR.utils.cleanupURL(impl.r2));
			}

			if (ename === "xhr" && edata) {
				if (edata && edata.data) {
					edata = edata.data;
				}
			}

			if (ename === "xhr" && edata) {
				subresource = edata.subresource;

				if (edata.url) {
					BOOMR.addVar("u", BOOMR.utils.cleanupURL(edata.url.replace(/#.*/, "")));
					impl.addedVars.push("u");
				}

				if (edata.status && (edata.status < -1 || edata.status >= 400)) {
					BOOMR.addVar("http.errno", edata.status);
				}

				if (edata.method && edata.method !== "GET") {
					BOOMR.addVar("http.method", edata.method);
				}

				if (edata.headers) {
					BOOMR.addVar("http.hdr", edata.headers);
				}

				if (edata.synchronous) {
					BOOMR.addVar("xhr.sync", 1);
				}

				if (edata.initiator) {
					BOOMR.addVar("http.initiator", edata.initiator);
				}

				impl.addedVars.push("http.errno", "http.method", "http.hdr", "xhr.sync", "http.initiator");
			}

			// This is an explicit subresource
			if (subresource && subresource !== "passive") {
				BOOMR.addVar("rt.subres", 1);
				impl.addedVars.push("rt.subres");
			}

			impl.updateCookie();

			if (ename==="unload") {
				BOOMR.addVar("rt.quit", "");

				if (!impl.onloadfired) {
					BOOMR.addVar("rt.abld", "");
				}

				if (!impl.visiblefired) {
					BOOMR.addVar("rt.ntvu", "");
				}
			}

			impl.complete = true;

			BOOMR.sendBeacon();

			return this;
		},

		is_complete: function() { return impl.complete; },

		navigationStart: function() {
			if (!impl.navigationStart) {
				impl.initFromNavTiming();
			}
			return impl.navigationStart;
		}
	};

}(window));
// End of RT plugin

BOOMR.t_end = new Date().getTime();
