import sample_py


def test_sample_hello_forwards_the_proper_greeting():
    assert sample_py.SamplePy().hello() == "Hello, World!"
