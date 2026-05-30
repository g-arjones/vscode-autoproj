import sample_module


def test_sample_module_hello_returns_proper_greeting():
    assert sample_module.SampleModule().hello() == "Hello, World!"
