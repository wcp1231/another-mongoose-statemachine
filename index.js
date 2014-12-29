'use strict';

var _ = require("lodash");

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

  schema.virtual('_states').get(function() {
    return schema.paths.state.enumValues;
  });

  function transitionize(t) {
    return function(callback) {
      var self = this;
      var transition = transitions[t];
      var from;
      var exit;

      if(_.isString(transition.from)) {
        from = transition.from;
      } else if(_.isArray(transition.from)) {
        from = _.find(transition.from, function(s) { return s === self.state; });
      }

      if(from) {
        exit = states[from].exit;
      }

      var enter = states[transition.to].enter;
      var guard = transition.guard;

      if(_.isFunction(guard)) {
        if(!guard.apply(self)) {
          return callback(new Error('guard failed'));
        }
      } else if(_.isPlainObject(guard)) {
        _.forEach(guard, function(v, k) {
          var tmp = v.apply(self);
          if(tmp) {
            self.invalidate(k, tmp);
          }
        });
        if(self.$__.validationError) {
          return callback(self.$__.validationError);
        }
      }

      if(self.state === from) {
        self.state = transition.to;

        if(_.has(defaultState, 'value')) {
          self.stateValue = states[self.state].value;
        }
      }

      self.save(function(err) {
        if(err) {
          return callback(err);
        }

        if(enter) { enter.call(self); }
        if(exit) { exit.call(self); }
        return callback();
      });
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
};

function staticTransitionize(transitionName) {
  return function(id, callback) {
    this.findOne({ _id: id }).exec(function(err, item) {
      if(err) {
        return callback(err);
      }
      if(!item) {
        return callback(new Error('finded null'));
      }
      item[transitionName].call(item, callback);
    });
  };
}

function getDefaultState(states) {
  var stateNames = _.keys(states);
  var selected = _.filter(stateNames, function(s) {
    return !!states[s].default;
  });
  return selected[0] || stateNames[0];
}
