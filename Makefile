all:
	cd client && go build -o wolp main.go

install:
	@echo "haha"

.PHONY: clean
clean:
	rm -rf client/wolp


