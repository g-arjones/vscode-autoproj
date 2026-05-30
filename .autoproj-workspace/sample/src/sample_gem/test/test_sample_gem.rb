require "minitest/autorun"
require "minitest/spec"
require "sample_gem/sample_gem"

class TestSampleGem < Minitest::Test
    def test_hello_returns_the_correct_greeting
        sample = SampleGem::SampleGem.new
        assert_equal "Hello, world!", sample.hello
    end
end
