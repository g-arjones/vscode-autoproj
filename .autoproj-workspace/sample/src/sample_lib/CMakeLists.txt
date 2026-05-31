cmake_minimum_required(VERSION 3.8)
project(sample_lib)

add_library(sample_lib src/SampleLib.cpp)
target_include_directories(sample_lib PUBLIC
  "$<BUILD_INTERFACE:${PROJECT_SOURCE_DIR}/include>"
  "$<INSTALL_INTERFACE:include>"
)
install(TARGETS sample_lib LIBRARY DESTINATION lib)
install(DIRECTORY include/ DESTINATION include/)

enable_testing()

find_package(GTest REQUIRED)
add_executable(test_sample_lib test/test_sample_lib.cpp)
target_link_libraries(test_sample_lib PUBLIC sample_lib GTest::gtest_main)
include(GoogleTest)
gtest_discover_tests(test_sample_lib)