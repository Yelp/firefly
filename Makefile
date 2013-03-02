.PHONY: production docs test tests
production:

docs:
	$(MAKE) -C docs html

tests: test

test:
	testify --summary --exclude-suite disabled tests
