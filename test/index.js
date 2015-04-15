'use strict';

var statemachine = require("../index");
var mongoose = require("mongoose");
var should = require('chai').should();
var sinon = require("sinon");

describe('state machine', function() {

  before(function(done) {
    mongoose.connect('mongodb://localhost:27017/statemachine-test');
    done();
  });

  after(function() {
    mongoose.connection.db.dropDatabase();
  });

  describe('schema', function() {

    it('should enumerate states', function() {
      var schema = new mongoose.Schema();

      schema.plugin(statemachine, {
        states: {
          a: {}, b: {}, c: {}
        },
        transitions: {
          x: { from: 'a', to: 'b' },
          y: { from: 'b', to: 'c', guard: function() { return true; } },
          z: { from: 'c', to: 'a' }
        }
      });

      schema.paths.state.enumValues.should.eql(['a', 'b', 'c']);
    });

  });

  describe('model', function() {

    var Model, model;

    before(function() {
      var schema = new mongoose.Schema();

      schema.plugin(statemachine, {
        states: {
          a: {}, b: {}, c: {}
        },
        transitions: {
          x: { from: 'a', to: 'b' },
          y: { from: 'b', to: 'c', guard: function() { return false; } },
          z: { from: ['b', 'c'], to: 'a' }
        }
      });

      Model = mongoose.model('Model', schema);
    });

    beforeEach(function() {
      model = new Model();
    });

    it('should expose available states', function() {
      model._states.should.eql(['a', 'b', 'c']);
    });

    it('should have transition methods', function() {
      model.x.should.be.a('function');
      model.y.should.be.a('function');
      model.z.should.be.a('function');
    });

    it('should have static transition methods', function() {
      Model.x.should.be.a('function');
      Model.y.should.be.a('function');
      Model.z.should.be.a('function');
    });

    it('should have a default state', function() {
      model.state.should.eql('a');
    });

    it('should look for a defined default state', function() {
      var DefaultState = new mongoose.Schema();
      DefaultState.plugin(statemachine, {
        states: { a: {}, b: { default: true } },
        transitions: {}
      });
      var Model_ = mongoose.model('DefaultState', DefaultState);
      model = new Model_();
      model.state.should.eql('b');
    });

    it('should transition between states', function(done) {
      model.x(function(err) {
        model.state.should.equal('b');
        done();
      });
    });

    it('should transition between states with static method', function(done) {
      Model.create({}).then(function(model) {
        Model.x(model._id, function(err) {
          Model.findOne({ _id: model._id }).exec(function(err, model) {
            model.state.should.equal('b');
            done();
          });
        });
      });
    });

    it('should throw error when find nothing', function(done) {
      var model = new Model();
      Model.x(model._id, function(err) {
        err.should.not.be.null
          .and.be.a('Error');
        done();
      });
    });

    it('should require transitions between states to be defined', function(done) {
      model.y(function(err) {
        model.state.should.eql('a');
        done();
      });
    });

    it('should accept an array of "from" states in the transition', function(done) {
      model = new Model({ state: 'b' });
      model.z(function(err) {
        model.state.should.eql('a');
        done();
      });
    });

    it('should guard transitions', function(done) {
      model = new Model({ state: 'b' });
      model.y(function(err) {
        model.state.should.eql('b');
        done();
      });
    });

    it('should save the document during transition', function(done) {
      model = new Model({ state: 'c' });
      model.z(function(err) {
        model.isNew.should.be.false;
        done();
      });
    });

  });

  describe('guard', function() {

    var Model;

    before(function(done) {
      var GuardSchema = new mongoose.Schema({
        attr1: String,
        attr2: String,
      });
      GuardSchema.plugin(statemachine, {
        states: { a: {}, b: {} },
        transitions: {
          f: {
            from: 'a', to: 'b',
            guard: {
              attr1: function() {
                if(!this.attr1) {
                  return 'required';
                }
              }
            }
          }
        }
      });

      Model = mongoose.model('GuardSchema', GuardSchema);
      done();
    });

    it('should protect the state', function(done) {
      var model = new Model();
      model.f(function(err) {
        model.state.should.eql('a');
        done();
      });
    });

    it('should invalidate the document', function(done) {
      var model = new Model();
      model.f(function(err) {
        err.errors.attr1.message.should.eql('required');
        done();
      });
    });
  });

  describe('after transition', function() {

    var Model;
    var enterA = sinon.spy();
    var enterB = sinon.spy();
    var enterC = sinon.spy();
    var exitA = sinon.spy();
    var transBehavior1 = sinon.spy();
    var transBehavior2 = sinon.spy();
    var transBehavior3 = sinon.spy();

    before(function() {

      var CallbackSchema = new mongoose.Schema();
      CallbackSchema.plugin(statemachine, {
        states: {
          a: { enter: enterA, exit: exitA },
          b: { enter: enterB },
          c: { enter: enterC }
        },
        transitions: {
          f: { from: 'a', to: 'b', behavior: transBehavior1 },
          f2: { from: 'a', to: 'c', behavior: transBehavior2 },
          f3: { from: 'a', to: 'a', behavior: transBehavior3 }
        }
      });

      Model = mongoose.model('CallbackSchema', CallbackSchema);
    });

    it('should call enter', function(done) {
      var model = new Model();
      model.f(function(err) {
        enterB.called.should.be.true;
        done();
      });
    });

    it('should call exit', function(done) {
      var model = new Model();
      model.f(function() {
        exitA.called.should.be.true;
        done();
      });
    });

    it('should call transition behavior', function(done) {
      var model = new Model();
      model.f(function() {
        transBehavior1.called.should.be.true;
        done();
      });
    });

    it('should call function once even if call transition many time', function(done) {
      var model = new Model();
      model.f2(function() {
        model.f2(function() {
          enterC.calledOnce.should.be.true;
          transBehavior2.calledOnce.should.be.true;
          done();
        });
      });
    });

    it('should call behavior but not call enter when trans to same state', function(done) {
      var model = new Model();
      model.f3(function() {
        model.f3(function() {
          enterA.called.should.be.false;
          transBehavior3.calledTwice.should.be.true;
          done();
        });
      });
    });

  });

  describe('state value', function() {

    var Model;

    before(function() {
      var schema = new mongoose.Schema();

      schema.plugin(statemachine, {
        states: {
          a: { value: 0 }, b: { value: 1 }, c: { value: 2 }
        },
        transitions: {
          x: { from: 'a', to: 'b' },
          y: { from: 'b', to: 'c', guard: function() { return false; } },
          z: { from: ['b', 'c'], to: 'a' }
        }
      });

      Model = mongoose.model('ValueModel', schema);
    });

    it('should have static method to get value', function() {
      Model.getStateValue.should.be.a('function');
      Model.getStateValue('a').should.be.equal(0);
      Model.getStateValue('b').should.be.equal(1);
      Model.getStateValue('c').should.be.equal(2);
    });

    it('should have a default state value', function() {
      var model = new Model();
      model.stateValue.should.eql(0);
    });

    it('should look for a defined default state value', function() {
      var DefaultState = new mongoose.Schema();
      DefaultState.plugin(statemachine, {
        states: { a: { value: 0 }, b: { value: 1, default: true } },
        transitions: {}
      });
      var Model_ = mongoose.model('DefaultStateValue', DefaultState);
      var model = new Model_();
      model.stateValue.should.eql(1);
    });

    it('should change value after transition', function(done) {
      var model = new Model();
      model.x(function(err) {
        model.state.should.eql('b');
        model.stateValue.should.equal(1);
        done();
      });
    });

  });

});
