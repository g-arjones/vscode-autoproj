require "minitest/autorun"
require "minitest/spec"
require "sample_rb/sample_rb"

module SampleRb
    describe "Sample" do
        it "returns the correct greeting" do
            assert_equal "Hello, world!", SampleRb.new.hello
        end
    end
end
