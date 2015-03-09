'use strict';

var chai = require('chai');
var should = chai.should();
var ChannelManager = require('../lib/channel-manager').ChannelManager;
var channelManager;
var redis = require('redis');
var client;

describe('ChannelManager', function () {
    beforeEach(function (done) {
        client = redis.createClient();
        channelManager = new ChannelManager();
        client.del('room:party-room:channels', done);
    });

    afterEach(function (done) {
        channelManager.subConn.quit();
        channelManager.pubConn.quit();
        client.quit();
        done();
    });

    it('should provide a subscribe function', function(done) {
        channelManager.subscribe('me', function (message) {
            message.should.equal('test 1');
            done();
        });
        channelManager.subscribers.should.have.property('me');
        channelManager.subscribers.me.should.have.property(0);
        setTimeout(function () {
            client.publish('me', 'test 1');
        }, 100);
    });

    it('should unsubscribe a channel with one callback', function() {
        var unsubscribe = channelManager.subscribe('me', function () {});
        channelManager.subscribers.should.have.property('me');
        channelManager.subscribers.me.should.have.property(0);
        unsubscribe();
        channelManager.subscribers.should.not.have.property('me');
    });

    it('should unsubscribe a callback member from a multi-callback channel', function() {
        var unsubscribe = channelManager.subscribe('me', function () {});
        channelManager.subscribe('me', function () {});
        channelManager.subscribers.should.have.property('me');
        unsubscribe();
        channelManager.subscribers.should.have.property('me');
    });

    it('should not break when unsubscribing multiple times', function() {
        var unsubscribe = channelManager.subscribe('me', function () {});
        channelManager.subscribers.should.have.property('me');
        channelManager.subscribers.me.should.have.property(0);
        unsubscribe();
        unsubscribe();
        channelManager.subscribers.should.not.have.property('me');
    });

    it('should be able to publish messages', function (done) {
        channelManager.subscribe('me', function (message) {
            message.should.equal('test 2');
            done();
        });
        channelManager.subscribers.should.have.property('me');
        channelManager.subscribers.me.should.have.property(0);
        setTimeout(function () {
            channelManager.publish('me', 'test 2');
        }, 100);
    });

    // rare case here
    it('should not break if channel event is not present in subscribers list', function (done) {
        channelManager.subscribe('me', function () {});
        delete channelManager.subscribers.me;
        setTimeout(function () {
            channelManager.publish('me', 'test 2');
            done();
        }, 100);
    });

    it('should be able to associate channels with rooms', function (done) {
        channelManager.enter('party-room', 'me').then(function () {
            client.smembers('room:party-room:channels', function (err, members) {
                members.should.have.length(1);
                members[0].should.equal('me');
                done();
            });
        });
    });

    it('should be able to remove a channel from a room', function (done) {
        channelManager.enter('party-room', 'me').then(function () {
            client.smembers('room:party-room:channels', function (err, members) {
                members.should.have.length(1);
                members[0].should.equal('me');
                channelManager.leave('party-room', 'me').then(function () {
                    client.smembers('room:party-room:channels', function (err, members) {
                        members.should.have.length(0);
                        done();
                    });
                });
            });
        });
    });

    it('should return an array of a rooms members', function (done) {
        channelManager.enter('party-room', 'me')
            .then(function () {
                return channelManager.enter('party-room', 'you');
            })
            .then(function () {
                return channelManager.members('party-room');
            })
            .then(function (members) {
                members.should.have.members(['me', 'you']);
                done();
            })
        ;
    });

    it('should close a room by deleting all memebers', function (done) {
        channelManager.enter('party-room', 'me')
            .then(function () {
                return channelManager.enter('party-room', 'you');
            })
            .then(function () {
                return channelManager.members('party-room');
            })
            .then(function (members) {
                members.should.have.members(['me', 'you']);
                return channelManager.close('party-room');
            })
            .then(function () {
                return channelManager.members('party-room');
            })
            .then(function(members) {
                members.should.have.length(0);
                done();
            })
        ;
    });

    it('should broadcast to a room', function (done) {
        channelManager.subscribe('me', function (message) {
            message.should.equal('hello');
            done();
        });
        channelManager.enter('party-room', 'me')
            .then(function () {
                channelManager.broadcast('party-room', 'hello');
            });
    });
});