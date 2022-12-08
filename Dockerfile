# Simple Python 3.11 Docker Container to run the scrapers in.

FROM python:3.10

# Copy the code

COPY . .

# Install Poetry

RUN pip install poetry

# Install the dependencies

RUN poetry install

# Run the scraper

CMD ["poetry", "run", "python3", "OddsScraper.py"]