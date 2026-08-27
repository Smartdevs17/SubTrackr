from setuptools import setup, find_packages

setup(
    name="subtrackr-sdk",
    version="1.0.0",
    description="Official SubTrackr Python SDK",
    author="SubTrackr",
    packages=find_packages(),
    install_requires=[
        "requests>=2.25.1",
    ],
    python_requires=">=3.8",
)
