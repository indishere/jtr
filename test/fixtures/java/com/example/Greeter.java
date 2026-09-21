package com.example;

public class Greeter {
    private String prefix;

    public Greeter(String prefix) {
        this.prefix = prefix;
    }

    public String greet(String name) {
        String message = prefix + ", " + name;
        System.out.println(message);
        return message;
    }

    public static int add(int a, int b) {
        return a + b;
    }
}
