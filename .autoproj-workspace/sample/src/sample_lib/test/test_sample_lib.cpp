#include <gtest/gtest.h>
#include <sample_lib/SampleLib.hpp>

TEST(SampleLibTest, returns_zero)
{
    SampleLib sample;
    EXPECT_EQ(sample.main(0, nullptr), 0);
}