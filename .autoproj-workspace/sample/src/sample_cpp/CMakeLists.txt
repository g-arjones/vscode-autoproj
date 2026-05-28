cmake_minimum_required(VERSION 3.8)
project(sample_cpp)

add_library(sample_cpp_lib src/Sample.cpp)
add_executable(sample_cpp_bin src/main.cpp)
target_link_libraries(sample_cpp_bin PUBLIC sample_cpp_lib)

install(
    TARGETS sample_cpp_bin
    LIBRARY DESTINATION lib
    RUNTIME DESTINATION bin
)

enable_testing()

find_package(GTest REQUIRED)
add_executable(test_sample_cpp test/test_sample_cpp.cpp)
target_link_libraries(test_sample_cpp PUBLIC sample_cpp_lib GTest::gtest_main)
include(GoogleTest)
gtest_discover_tests(test_sample_cpp)