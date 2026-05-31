require "minitest/autorun"
require "minitest/spec"
require "sample_rb/sample_rb"

class TestSampleRb < Minitest::Test
    def test_hello_forwards_the_correct_greeting
        sample = SampleRb::SampleRb.new
        assert_equal "Hello, world!", sample.hello
    end
end
