var chai = require('chai');
var expect = chai.expect;

var { HttpWrapper } = require('../src/HttpWrapper.js');

describe('HttpWrapper', function() {
	var http = new HttpWrapper();
	describe('#getRaw', function() {
		describe('success', function() {
			var result;
			before(async function() {
				// known good call to accounts API
				// use webmaster as user shouldn't change
				result = await http.getRaw("https://api.eclipse.org/account/profile/webmaster");
			});

			it('should return 200 status', function() {
				expect(result).to.include({status: 200});
			});
			
			it('should return Object as data', function() {
				expect(result).property('data').to.be.an('object');
			});
		});
		
		describe('not found', function() {
			var result;
			before(async function() {
				// call to user that shouldn't exist
				result = await http.getRaw("https://api.eclipse.org/account/profile/webmaster-123456789456123");
				// fail if there was an error communicating and we get no data back
				if (!(result instanceof Object)) { done(false) }
			});

			it('should return response object in root', function() {
				expect(result).to.have.property('response').that.is.an('object');
			});

			it('should return 404 status', function() {
				expect(result).to.have.nested.include({'response.status': 404});
			});
			
			it('should return response data as a property if present', function() {
				expect(result).to.have.nested.property('response.data');
			});
		});
	});

	
	describe('#getData', function() {
		describe('success', function() {
			var result;
			before(async function() {
				// known good call to accounts API
				// use webmaster as user shouldn't change
				result = await http.getData("https://api.eclipse.org/account/profile/webmaster");
			});
			
			it('should return Object as data', function() {
				expect(result).to.be.an('object');
			});
		});
		
		describe('not found', function() {
			var result;
			before(async function() {
				// call to user that shouldn't exist
				result = await http.getData("https://api.eclipse.org/account/profile/webmaster-123456789456123");
			});

			it('should return undefined as response for error', function() {
				expect(result).to.be.undefined;
			});
		});
	});
});