'use strict';

var _ = require("lodash");
var Promise = require('bluebird');

module.exports = function (schema, options) {
  var states = options.states;
  var transitions = options.transitions;
  var stateNames = _.keys(states);
  var transitionNames = _.keys(transitions);

  var defaultStateName = getDefaultState(states);
  var defaultState = states[defaultStateName];

  schema.add({ state: { type: String,
                        enum: stateNames,
                        default: defaultStateName } });

  if(_.has(defaultState, 'value')) {
    schema.add({ stateValue: { type: Number,
                               default: defaultState.value } });

    schema.statics.getStateValue = function(stateName) {
      return states[stateName].value;
    };
  }

  var transitionMethods = {};
  var transitionStatics = {};
  transitionNames.forEach(function(t) {
    transitionMethods[t] = transitionize(t);
    transitionStatics[t] = staticTransitionize(t);
  });
  schema.method(transitionMethods);
  schema.static(transitionStatics);

  function transitionize(t) {
    return function(callback) {
      var Model = this.constructor;
      return Model[t].call(Model, this, callback);
    };
  }

  function staticTransitionize(transitionName) {
    var transition = transitions[transitionName];
    var enter = states[transition.to].enter;
    var behavior = transition.behavior;
    // stateA -> stateA ...
    var stateChanged = false;
    var transitionHappend;
    var toStateValue;
    var query = {};
    var from;
    var exit;

    if(_.has(defaultState, 'value')) {
      toStateValue = states[transition.to].value;
    }

    if(_.isString(transition.from)) {
      if('*' !== transition.from) {
        query.state = transition.from;
      }
    } else if(_.isArray(transition.from)) {
      query.state = { $in: transition.from };
    }

    return function(id, callback) {
      var Model = this;
      var instance;
      query._id = id;

      if (id instanceof Model) {
        instance = id;
        query._id = id._id;
      }

      return (new Promise(function(resolve, reject) {
        Model.findOne(query).exec(function(err, item) {
          if(err) {
            return reject(err);
          }
          if(!item) {
            return reject(new Error('found null'));
          }

          var update = {
            state: transition.to,
            stateValue: states[transition.to].value
          };

          transitionHappend = true;
          stateChanged = item.state !== transition.to;
          from = item.state;
          exit = states[from].exit;

          query.state = from;
          Model.update(query, update).exec(function(err, r) {
            if (err) {
              return reject(err);
            }

            instance = instance || item;
            instance.state = update.state;
            instance.stateValue = update.stateValue;
            resolve(r);
          });
        });
      })).then(function(result) {

        if(result.n === 0) {
          return Promise.reject(new Error('state not changed'));
        }

        var callbacks = [];

        if(behavior && transitionHappend) {
          callbacks.push(behavior.call(instance));
        }
        if(result.nModified > 0) {
          if(exit && stateChanged) { callbacks.push(exit.call(instance)); }
          if(enter && stateChanged) { callbacks.push(enter.call(instance)); }
        }

        return Promise.all(callbacks);
      }).nodeify(callback);
    };
  }
};


function getDefaultState(states) {
  var stateNames = _.keys(states);
  var selected = _.filter(stateNames, function(s) {
    return !!states[s].default;
  });
  return selected[0] || stateNames[0];
}
