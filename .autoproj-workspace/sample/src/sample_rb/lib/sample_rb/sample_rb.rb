require "sample_gem/sample_gem"

module SampleRb
    VERSION = "0.1.0"

    class SampleRb
        def hello
            SampleGem::SampleGem.new.hello
        end
    end
end
