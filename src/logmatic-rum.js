(function () {

  // configuration
  var _config = {
    number_of_worst_entries: 10,
    logger: undefined
  };

  var _logmatic;

  /**
   * Decode a trie structure to a flatten object
   *
   * @param [object] trie encoded
   * @return {{}}: flatten representation of the initial trie
   */
  function trieDecoder(trie) {
    var decodedTrie = {};

    for (var i in trie) {
      if (!trie.hasOwnProperty(i)) continue;

      if ((typeof trie[i]) == 'object' && trie[i] !== null) {
        var flatObject = trieDecoder(trie[i]);
        for (var x in flatObject) {
          if (!flatObject.hasOwnProperty(x)) continue;
          decodedTrie[i + x] = flatObject[x];
        }
      } else {
        decodedTrie[i] = trie[i];
      }
    }

    return decodedTrie;
  }

  /**
   * This function decode the restiming trie to a simplify Json Object
   *
   * @param restiming
   * @returns {{}}
   */
  function restimingDecoder(restiming) {

    var flattenEntries = trieDecoder(restiming);
    var assets = {};

    var types = ["other", "img", "link", "script", "css", "xmlhttprequest"];


    // for each asset, compute an entry
    Object.keys(flattenEntries).forEach(function (key) {

      var entry = {};

      // get the url
      entry.name = BOOMR.utils.cleanupURL(key);

      // get the initiator type (@see https://soasta.github.io/boomerang/doc/api/restiming.html)
      entry.type = types[flattenEntries[key].charAt(0)];

      // decode timers
      var timers = flattenEntries[key].slice(1).split("|")[0];
      timers = timers.split(",").map(function (v) {
        // base 36 to int
        return parseInt(v, 36);
      });

      // keep only the load time
      entry.time = timers[1];

      // init the final output
      assets.nb = assets.nb || 0;
      assets.t_max = assets.t_max || 0;
      assets.entries = assets.entries || [];
      assets[entry.type] = assets[entry.type] || {};
      assets[entry.type].nb = assets[entry.type].nb || 0;
      assets[entry.type].t_max = assets[entry.type].t_max || 0;

      // update the number of items
      assets.nb++;
      assets.t_max = Math.max(entry.time, assets.t_max);

      // add the asset to the corresponding group
      assets.entries.push(entry);
      assets[entry.type].nb++;
      assets[entry.type].t_max = Math.max(entry.time, assets[entry.type].t_max);

    });

    // sort restiming per time loaded
    assets.entries.sort(function (e1, e2) {
      // sort: DESC, based on the time loaded
      return e2.time - e1.time;
    });

    // compute the worst-top restiming
    if (_config.number_of_worst_entries === -1) {
      assets.worst_entries = assets.entries.slice();
    } else {
      assets.worst_entries = assets.entries.slice(0, _config.number_of_worst_entries);
    }
    assets.entries = undefined;

    // display it as human-readable
    assets.worst_entries = assets.worst_entries.map(function (item) {
      return item.name + " took " + item.time + " ms";
    });

    return assets;

  }

  /**
   * Report the beacon directly to Logmatic, using logmatic log handler
   *
   * @param beacon
   */
  var sendToLogmatic = function (beacon) {

    var logmaticBeacon = {};

    // basic info
    logmaticBeacon.rum = {};
    logmaticBeacon.rum.t_done = beacon.t_done;
    logmaticBeacon.rum.t_resp = beacon.t_resp || undefined;
    logmaticBeacon.rum.t_page = beacon.t_page || undefined;
    logmaticBeacon.url = location.href;
    logmaticBeacon.domain = location.hostname;


    // assets
    if (beacon.restiming) {
      logmaticBeacon.rum.restiming = restimingDecoder(JSON.parse(beacon.restiming));
    }

    // others timers
    if (beacon.t_other !== undefined) {
      var others = beacon.t_other.split(",");
      var t_other = {};
      for (var i = 0; i < others.length; i++) {
        var item = others[i].split("|");
        t_other[item[0]] = parseInt(item[1]);
      }
      logmaticBeacon.rum.RT = t_other;
    }

    var message = "'" + location.href.replace(location.origin, "");
    message += "' loaded in " + logmaticBeacon.rum.t_done + " ms";

    _logmatic.log(message, logmaticBeacon);


  };

  // Boomerang stuff
  BOOMR = BOOMR || {};
  BOOMR.plugins = BOOMR.plugins || {};
  BOOMR.plugins.Logmatic = {
    init: function (config) {

      // This block is only needed if you actually have user configurable properties
      BOOMR.utils.pluginConfig(_config, config, "Logmatic", ["number_of_worst_entries", "logger"]);

      if (_config.logger === undefined) {
        if (logmatic === undefined) {
          return; // do nothing if Logmatic libs are not loaded
        }
        _logmatic = logmatic;
      } else {
        _logmatic = _config.logger;
      }

      // bind Logmatic and Boomerang
      BOOMR.subscribe('before_beacon', function (beacon) {
        sendToLogmatic(beacon);
      });

    },
    is_complete: function () {
      return true;
    },
    sendToLogmatic: sendToLogmatic
  }


}());


