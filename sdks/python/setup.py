from pathlib import Path

from setuptools import find_packages, setup

setup(
    name="subtrackr-sdk",
    version="2.0.0",
    description="Official SubTrackr Python SDK",
    long_description=(Path(__file__).parent / "README.md").read_text(encoding="utf-8"),
    long_description_content_type="text/markdown",
    author="SubTrackr",
    url="https://github.com/Smartdevs17/SubTrackr/tree/main/sdks/python",
    project_urls={
        "Source": "https://github.com/Smartdevs17/SubTrackr",
        "Changelog": "https://github.com/Smartdevs17/SubTrackr/blob/main/sdks/CHANGELOG.md",
    },
    packages=find_packages(exclude=["tests", "tests.*"]),
    install_requires=[
        "requests>=2.25.1",
    ],
    python_requires=">=3.8",
)
