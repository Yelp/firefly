.PHONY: production docs test tests
production:

docs:
	$(MAKE) -C docs html

tests: test

test:
	tox

clean:
	find . -name "*.pyc" -delete
	find . -name "__pycache__" -delete
