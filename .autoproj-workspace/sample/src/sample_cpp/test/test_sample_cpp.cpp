#include <gtest/gtest.h>

#include "../src/Sample.hpp"

TEST(SampleTest, SampleTest)
{
    Sample sample;
    EXPECT_EQ(sample.main(0, nullptr), 0);
}