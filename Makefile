.PHONY: production docs test tests
production:

docs:
	$(MAKE) -C docs html

tests: test

test:
	testify --summary -x disabled tests
