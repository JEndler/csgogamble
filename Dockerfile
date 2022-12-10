# Simple Python 3.11 Docker Container to run the scrapers in.

FROM python:3.10

# Copy the code

COPY ./*.py ./
COPY pyproject.toml ./

# Install Poetry

RUN pip install poetry

# Install the dependencies

RUN poetry install

# Run the scraper docker run -d -v /home/jakob/csgogamble/data:/data 87205d71155c
CMD ["poetry", "run", "python3", "OddsScraper.py"]